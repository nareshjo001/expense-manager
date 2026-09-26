"use strict";

// DAT-001-T04 -- backfills the *Minor integer-paise shadow fields
// (ADR-0003) from the existing float money fields, for every document
// that doesn't have its *Minor field yet. Purely additive: never reads
// or writes the legacy field's value, and every legacy field keeps
// working exactly as before. Uses the same toMinorUnits() rounding rule
// (ADR-0003, DAT-001-T03) the application itself uses, so a backfilled
// document and a freshly-written one always agree bit-for-bit -- that
// agreement is exactly what DAT-001-T05's dual-read verification checks
// for.
//
// Idempotent and safe to re-run: each pass only looks at documents
// still missing their *Minor field, so a partial run (or DAT-003's
// batch/resume driver splitting this across invocations) just picks up
// where it left off, same as any other migration in this pipeline.
const { toMinorUnits } = require("../../utils/money");

// DAT-002-T06 correction (2026-09-21) -- "budget" and "recurringExpenses"
// below were never the real MongoDB collection names. config/Schemas.js
// registers the budget model as mongoose.model('budget', budgetSchema)
// and models/RecurringExpense.js registers
// mongoose.model('recurringExpenses', RecurringExpenseSchema); Mongoose
// pluralizes/lowercases both of those to derive the actual collection
// name whenever no explicit `collection` schema option overrides it (this
// codebase sets none) -- confirmed directly against the real mongoose
// package, not assumed: 'budget' -> "budgets", 'recurringExpenses' ->
// "recurringexpenses". Every application read/write already goes through
// the Model (BudgetModel, RecurringExpenseModel), which always resolves
// the correct real name automatically -- only this migration's direct,
// string-keyed db.collection(...) calls bypassed that and silently
// targeted a nonexistent collection, matching zero real documents on
// every run without ever raising an error. Caught while investigating
// DAT-002-T06's orphan/duplicate integrity checks, well after this
// migration's own DAT-001-T04 tests were written and passing -- those
// tests use a fake db keyed by the same (until now, wrong) literal
// strings, so they never could have caught this themselves.
const FIELD_MAP = [
  { collection: "expenses", legacyField: "expenseAmount", minorField: "expenseAmountMinor" },
  { collection: "incomes", legacyField: "incomeAmount", minorField: "incomeAmountMinor" },
  { collection: "budgets", legacyField: "budget", minorField: "budgetMinor" },
  { collection: "budgets", legacyField: "spent", minorField: "spentMinor" },
  { collection: "recurringexpenses", legacyField: "expenseAmount", minorField: "expenseAmountMinor" },
];

const BATCH_SIZE = 500;

async function backfillOne({ db, collection, legacyField, minorField, logger, dryRun }) {
  const coll = db.collection(collection);
  const cursor = coll.find(
    { [legacyField]: { $exists: true }, [minorField]: { $exists: false } },
    { projection: { [legacyField]: 1 } }
  );

  let batch = [];
  let updatedCount = 0;
  let skippedCount = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    if (!dryRun) {
      // eslint-disable-next-line no-await-in-loop
      await coll.bulkWrite(batch, { ordered: false });
    }
    updatedCount += batch.length;
    batch = [];
  };

  // eslint-disable-next-line no-restricted-syntax
  for await (const doc of cursor) {
    const legacyValue = doc[legacyField];
    if (typeof legacyValue !== "number" || !Number.isFinite(legacyValue)) {
      // A non-numeric/NaN legacy value is a pre-existing data problem
      // this migration doesn't try to fix -- log it and move on rather
      // than crashing the whole backfill over one bad document.
      skippedCount += 1;
      logger.warn({
        event: "skip_non_numeric_legacy_value",
        collection,
        docId: String(doc._id),
        legacyField,
      });
      // eslint-disable-next-line no-continue
      continue;
    }

    const minorValue = toMinorUnits(legacyValue);
    if (dryRun) {
      batch.push({ docId: String(doc._id) }); // just for a count in dry-run logs
    } else {
      batch.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { [minorField]: minorValue } },
        },
      });
    }

    if (batch.length >= BATCH_SIZE) {
      // eslint-disable-next-line no-await-in-loop
      await flush();
    }
  }
  await flush();

  logger.info({
    event: dryRun ? "would_backfill" : "backfilled",
    collection,
    legacyField,
    minorField,
    count: updatedCount,
    skipped: skippedCount,
  });
}

module.exports = {
  id: "20260903-backfill-money-minor-fields",
  description:
    "Backfill the *Minor integer-paise shadow fields (ADR-0003) from the existing float money fields, additive only -- legacy fields are never read for anything but the conversion, and never written or removed.",

  async up({ mongoose, logger, dryRun }) {
    const db = mongoose.connection.db;
    for (const spec of FIELD_MAP) {
      // eslint-disable-next-line no-await-in-loop
      await backfillOne({ db, ...spec, logger, dryRun });
    }
  },

  async verify({ mongoose, logger }) {
    const db = mongoose.connection.db;
    for (const { collection, legacyField, minorField } of FIELD_MAP) {
      const coll = db.collection(collection);
      // eslint-disable-next-line no-await-in-loop
      const remaining = await coll.countDocuments({
        [legacyField]: { $exists: true, $type: "number" },
        [minorField]: { $exists: false },
      });
      if (remaining > 0) {
        throw new Error(
          `${remaining} document(s) in "${collection}" still missing "${minorField}" after up() ` +
            `(legacy field "${legacyField}" is a number but the shadow field was not backfilled)`
        );
      }
    }
    logger.info({ event: "verify_ok", fieldsBackfilled: FIELD_MAP.length });
  },
};
