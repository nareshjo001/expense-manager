"use strict";

// DAT-003-T06 -- the first real migration through this pipeline. Chosen
// deliberately low-risk: explicitly (re-)creates indexes that
// config/Schemas.js and models/RecurringExpense.js already declare via
// schema.index() calls, which Mongoose's autoIndex option currently
// creates automatically on every connection. createIndex() is
// idempotent -- a no-op when the index already exists with the same
// spec -- so this migration is safe against a database that already has
// these indexes (today, via autoIndex), and is exactly the mechanism a
// deployment that disables autoIndex (a common production practice,
// since an implicit index build on every app startup is itself a real
// production risk on a large collection) would need instead. verify()
// confirms every index this migration asks for is actually present
// afterward, per ADR-0006's "check the outcome, don't just trust up()"
// requirement.
const INDEX_SPECS = [
  {
    collection: "expenses",
    key: { userId: 1, id: 1 },
    options: { unique: true, name: "userId_1_id_1" },
  },
  {
    collection: "expenses",
    key: { userId: 1, expenseDate: 1 },
    options: { name: "userId_1_expenseDate_1" },
  },
  {
    collection: "incomes",
    key: { userId: 1, incomeDate: 1 },
    options: { name: "userId_1_incomeDate_1" },
  },
  {
    collection: "budget",
    key: { userId: 1, month: 1 },
    options: { unique: true, name: "userId_1_month_1" },
  },
  {
    collection: "recurringExpenses",
    key: { userId: 1, expenseId: 1 },
    options: { unique: true, name: "userId_1_expenseId_1" },
  },
  {
    collection: "recurringExpenses",
    key: { nextDueDate: 1 },
    options: { name: "nextDueDate_1" },
  },
];

module.exports = {
  id: "20260903-ensure-core-indexes",
  description:
    "Explicitly (re-)create the userId-scoped indexes expenses/incomes/budget/recurringExpenses already declare in their schemas, so index presence does not depend on Mongoose's autoIndex running on every app startup.",

  async up({ mongoose, logger, dryRun }) {
    const db = mongoose.connection.db;
    for (const spec of INDEX_SPECS) {
      if (dryRun) {
        logger.info({ event: "would_create_index", collection: spec.collection, name: spec.options.name });
        // eslint-disable-next-line no-continue
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await db.collection(spec.collection).createIndex(spec.key, spec.options);
      logger.info({ event: "index_created", collection: spec.collection, name: spec.options.name });
    }
  },

  async verify({ mongoose, logger }) {
    const db = mongoose.connection.db;
    for (const spec of INDEX_SPECS) {
      // eslint-disable-next-line no-await-in-loop
      const indexes = await db.collection(spec.collection).indexes();
      const found = indexes.some((idx) => idx.name === spec.options.name);
      if (!found) {
        throw new Error(
          `Expected index "${spec.options.name}" on collection "${spec.collection}" was not found after up()`
        );
      }
    }
    logger.info({ event: "verify_ok", indexCount: INDEX_SPECS.length });
  },
};
