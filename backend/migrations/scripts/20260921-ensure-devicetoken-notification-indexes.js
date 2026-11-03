"use strict";

// UserId have no index at all").
const INDEX_SPECS = [
  {
    collection: "devicetokens",
    key: { userId: 1 },
    options: { name: "userId_1" },
  },
  {
    collection: "notifications",
    key: { userId: 1 },
    options: { name: "userId_1" },
  },
];

module.exports = {
  id: "20260921-ensure-devicetoken-notification-indexes",
  description:
    "Explicitly (re-)create the userId indexes devicetokens/notifications now declare in their schemas (DAT-002-T03), so index presence does not depend on Mongoose's autoIndex running on every app startup.",

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
