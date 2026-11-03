"use strict";

// Js's on-disk migration list down to the ones NOT yet recorded as applied.
const MigrationLedger = require("../models/MigrationLedger");
const runner = require("./runner");

// True if `migrationId` has already been recorded as applied.
async function isApplied(migrationId) {
  const doc = await MigrationLedger.findOne({ migrationId }).lean();
  return doc !== null;
}

// The full set of applied migration ids, for filtering a migration list
// in one query instead of one findOne per migration.
async function getAppliedIds() {
  const docs = await MigrationLedger.find({}, { migrationId: 1, _id: 0 }).lean();
  return new Set(docs.map((d) => d.migrationId));
}

// Records a migration as applied.
async function recordApplied({ id, description, durationMs }) {
  return MigrationLedger.create({
    migrationId: id,
    description,
    durationMs,
  });
}

// Ledger-aware version of runner.js's planPending(): only migrations that
// exist on disk AND are not yet recorded in the ledger are "pending".
async function planPending(dir = runner.MIGRATIONS_DIR) {
  const [migrations, appliedIds] = await Promise.all([
    Promise.resolve(runner.loadMigrations(dir)),
    getAppliedIds(),
  ]);
  return migrations
    .filter((m) => !appliedIds.has(m.id))
    .map(({ id, description, filename }) => ({ id, description, filename }));
}

module.exports = {
  isApplied,
  getAppliedIds,
  recordApplied,
  planPending,
};
