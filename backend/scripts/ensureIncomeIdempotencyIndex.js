/* ensureIncomeIdempotencyIndex.js */

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
