"use strict";

// Drops the legacy single-field `id_1` index on expenses.
const COLLECTION = "expenses";
const LEGACY_INDEX = "id_1";
const REPLACEMENT_INDEX = "userId_1_id_1";

// A fresh database (CI's ephemeral Mongo, a new environment) may not have an expenses collection yet, and listing indexes of a missing collection throws NamespaceNotFound (code 26).
async function listIndexes(coll) {
  try {
    return await coll.indexes();
  } catch (err) {
    if (err && (err.code === 26 || err.codeName === "NamespaceNotFound")) return [];
    throw err;
  }
}

function isLegacyIdIndex(idx) {
  return idx.name === LEGACY_INDEX && JSON.stringify(idx.key) === JSON.stringify({ id: 1 });
}

module.exports = {
  id: "20260926-drop-legacy-expense-id-index",
  description:
    "Drop the legacy global-unique id_1 index on expenses; per-user uniqueness is enforced by userId_1_id_1.",

  async up({ mongoose, logger, dryRun }) {
    const coll = mongoose.connection.db.collection(COLLECTION);
    const indexes = await listIndexes(coll);
    const legacy = indexes.find(isLegacyIdIndex);

    if (!legacy) {
      logger.info({ event: "legacy_index_absent", collection: COLLECTION, name: LEGACY_INDEX });
      return;
    }
    if (!indexes.some((idx) => idx.name === REPLACEMENT_INDEX)) {
      throw new Error(
        `Refusing to drop ${LEGACY_INDEX}: ${REPLACEMENT_INDEX} is missing on ${COLLECTION}, so nothing would enforce per-user id uniqueness. Apply 20260903-ensure-core-indexes first.`
      );
    }
    if (dryRun) {
      logger.info({ event: "would_drop_index", collection: COLLECTION, name: LEGACY_INDEX, unique: Boolean(legacy.unique) });
      return;
    }
    await coll.dropIndex(LEGACY_INDEX);
    logger.info({ event: "index_dropped", collection: COLLECTION, name: LEGACY_INDEX, unique: Boolean(legacy.unique) });
  },

  async verify({ mongoose, logger }) {
    const indexes = await listIndexes(mongoose.connection.db.collection(COLLECTION));
    if (indexes.some(isLegacyIdIndex)) {
      throw new Error(`${LEGACY_INDEX} is still present on ${COLLECTION} after up()`);
    }
    if (!indexes.some((idx) => idx.name === REPLACEMENT_INDEX)) {
      throw new Error(`${REPLACEMENT_INDEX} is missing on ${COLLECTION}`);
    }
    logger.info({ event: "verify_ok", collection: COLLECTION });
  },
};
