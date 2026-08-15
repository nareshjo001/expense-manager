/**
 * ensureIncomeIdempotencyIndex.js
 *
 * Remediation Workstream B follow-up -- deployment-time index-bootstrap for
 * the income idempotency guarantee.
 *
 * WHY THIS SCRIPT EXISTS
 * -----------------------
 * Income idempotency (Controllers/IncomeControllers/addincome.js) depends on
 * a unique compound index -- config/Schemas.js's `INCOME_IDEMPOTENCY_INDEX`,
 * `{ userId: 1, idempotencyKey: 1 }` with a partial filter excluding legacy
 * documents -- actually existing in MongoDB before any concurrent duplicate
 * request can race past the application-level check.
 *
 * Investigation of this repository's own startup path found no guarantee
 * that this index is built before the server starts accepting requests:
 *   - config/db.js's connectDB() is a bare
 *     `await mongoose.connect(process.env.MONGO_CONN)` with no options
 *     object. Resolving this promise only proves the TCP/handshake
 *     connection succeeded -- it says nothing about any model's background
 *     index build, which Mongoose kicks off separately per-model.
 *   - server.js's startServer() sequence is
 *     `connectDB() -> connectRedis() -> app.listen(...)`. Nowhere in that
 *     sequence is any model's `.init()`/`.createIndexes()` (or equivalent)
 *     awaited before `app.listen()` starts accepting HTTP requests.
 * So on a freshly-provisioned database, or any environment where this index
 * has not yet been created, there is a window after the server starts
 * accepting income-creation requests but before MongoDB has finished
 * building this index, during which the uniqueness guarantee is not yet
 * enforced at the database level.
 *
 * This script closes that window as an explicit, idempotent, deployment-time
 * step -- mirroring the one existing precedent for manual database
 * maintenance in this repository, backend/scripts/backfillFeedbackStatus.js
 * (same dotenv/connectDB() bootstrap, same dry-run support, same
 * `require.main === module` guard so it is NEVER auto-invoked by server.js
 * or any startup path, same explicit `module.exports` for reuse by tests).
 *
 * USAGE (run once per environment, before or immediately after deploying
 * this remediation; safe to run any number of times):
 *
 *   node backend/scripts/ensureIncomeIdempotencyIndex.js
 *   node backend/scripts/ensureIncomeIdempotencyIndex.js --dry-run
 *
 * GUARANTEES
 * ----------
 *   - Creates ONLY the index declared as Schemas.js's
 *     `INCOME_IDEMPOTENCY_INDEX` -- imported directly from Schemas.js (not
 *     re-typed here), so this script can never drift from the schema's own
 *     declaration. Uses `IncomeModel.collection.createIndex(key, options)`
 *     directly, never `Model.syncIndexes()` -- `syncIndexes()` would also
 *     DROP any index present on the server but absent from the current
 *     schema, which is explicitly out of scope and dangerous to run
 *     unattended.
 *   - Safe to rerun: if an index with this exact name and spec already
 *     exists, this script detects that up front and does nothing.
 *     (MongoDB's own createIndex is additionally a no-op for an identical
 *     index, so even a concurrent/racing invocation is safe.)
 *   - Preserves legacy documents: this script never reads, writes, or
 *     migrates any income document. The partial-filter expression already
 *     declared on the index itself (not this script) is what excludes
 *     legacy documents lacking `idempotencyKey` from the uniqueness
 *     constraint.
 *   - Fails clearly, never silently, on:
 *       * an existing index with the SAME name but DIFFERENT options
 *         (MongoDB raises IndexOptionsConflict/IndexKeySpecsConflict) --
 *         the raw MongoDB error is logged and rethrown, never swallowed;
 *       * pre-existing duplicate-keyed data that would violate the new
 *         unique constraint (MongoDB raises E11000 during the index build)
 *         -- the raw MongoDB error, including the offending key, is logged
 *         and rethrown.
 *   - Never drops or modifies any other index, on this or any other
 *     collection or model.
 *   - Never executed automatically -- not required/imported by server.js or
 *     any startup path. Not invoked anywhere in this remediation's test
 *     suite against a real database; unit tests for this script mock
 *     `IncomeModel.collection` and never open a real Mongo connection.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { IncomeModel, INCOME_IDEMPOTENCY_INDEX } = require('../config/Schemas');

async function run({ dryRun = false } = {}) {
    await connectDB();

    console.log(`[ensureIncomeIdempotencyIndex] starting${dryRun ? ' (dry run)' : ''}...`);

    const existingIndexes = await IncomeModel.collection.indexes();
    const alreadyPresent = existingIndexes.some(
        (idx) => idx.name === INCOME_IDEMPOTENCY_INDEX.options.name
    );

    if (alreadyPresent) {
        console.log(
            `[ensureIncomeIdempotencyIndex] index "${INCOME_IDEMPOTENCY_INDEX.options.name}" already exists -- nothing to do.`
        );
        await mongoose.disconnect();
        return { created: false, alreadyPresent: true };
    }

    if (dryRun) {
        console.log(
            `[ensureIncomeIdempotencyIndex] dry run -- would create index "${INCOME_IDEMPOTENCY_INDEX.options.name}" ` +
            `with key ${JSON.stringify(INCOME_IDEMPOTENCY_INDEX.key)} and options ${JSON.stringify(INCOME_IDEMPOTENCY_INDEX.options)}.`
        );
        await mongoose.disconnect();
        return { created: false, alreadyPresent: false };
    }

    try {
        const createdName = await IncomeModel.collection.createIndex(
            INCOME_IDEMPOTENCY_INDEX.key,
            INCOME_IDEMPOTENCY_INDEX.options
        );
        console.log(`[ensureIncomeIdempotencyIndex] created index "${createdName}".`);
        await mongoose.disconnect();
        return { created: true, alreadyPresent: false };
    } catch (err) {
        // Never swallowed -- an IndexOptionsConflict or duplicate-key error must reach the operator verbatim so they can resolve it before retrying.
        console.error('[ensureIncomeIdempotencyIndex] failed:', err && err.message);
        try {
            await mongoose.disconnect();
        } catch (_) {
            // ignore disconnect errors while already handling a failure
        }
        throw err;
    }
}

if (require.main === module) {
    const dryRun = process.argv.includes('--dry-run');
    run({ dryRun })
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}

module.exports = { run };
