"use strict";

// Md) is actually enforced by the database. verify() confirms the index is present afterward (ADR-0006).
const INDEX_SPECS = [
  {
    collection: "categorybudgets",
    key: { userId: 1, month: 1, category: 1 },
    options: { unique: true, name: "userId_month_category_unique" },
  },
];

module.exports = {
  id: "20260926-ensure-category-budget-indexes",
  description:
    "Explicitly (re-)create the unique {userId, month, category} index on categorybudgets that models/CategoryBudget.js declares, so BUD-001's one-allocation-per-category invariant does not depend on Mongoose's autoIndex.",

  async up({ mongoose, logger, dryRun }) {
    const db = mongoose.connection.db;
    for (const spec of INDEX_SPECS) {
      if (dryRun) {
        logger.info({ event: "would_create_index", collection: spec.collection, name: spec.options.name });
        continue;
      }
      await db.collection(spec.collection).createIndex(spec.key, spec.options);
      logger.info({ event: "index_created", collection: spec.collection, name: spec.options.name });
    }
  },

  async verify({ mongoose, logger }) {
    const db = mongoose.connection.db;
    for (const spec of INDEX_SPECS) {
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
