"use strict";

// The first real migration through this pipeline.
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
    collection: "budgets",
    key: { userId: 1, month: 1 },
    options: { unique: true, name: "userId_1_month_1" },
  },
  {
    collection: "recurringexpenses",
    key: { userId: 1, expenseId: 1 },
    options: { unique: true, name: "userId_1_expenseId_1" },
  },
  {
    collection: "recurringexpenses",
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
