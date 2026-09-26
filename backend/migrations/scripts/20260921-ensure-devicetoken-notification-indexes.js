"use strict";

// DAT-002-T03 -- explicitly (re-)creates the two userId indexes added in
// this task to models/DeviceToken.js and models/Notification.js (gap 3.3,
// docs/data/DAT-002-T01-schema-and-index-inventory.md: "DeviceToken.userId
// and Notification.userId have no index at all"). Mirrors
// 20260903-ensure-core-indexes.js's (DAT-003-T06) pattern exactly, for the
// same reason that migration gives: createIndex() is idempotent, so this is
// a no-op today (both indexes already exist via Mongoose's default
// autoIndex behavior) and becomes the actual mechanism a deployment that
// disables autoIndex would need. verify() confirms both indexes are
// present afterward, per ADR-0006.
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
