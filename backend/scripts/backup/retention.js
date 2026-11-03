"use strict";

// Retention pruning as its own pure, testable function. ADR-0005 sets a provisional "35 rolling daily backups" target.
const DEFAULT_RETENTION_COUNT = 35;

function retentionCountFromEnv(env = process.env) {
  const raw = env.BACKUP_RETENTION_COUNT;
  const parsed = raw !== undefined ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_COUNT;
}

// Js's listManifestsSync does this).
function planRetention(manifests, retentionCount = DEFAULT_RETENTION_COUNT) {
  const list = Array.isArray(manifests) ? manifests : [];
  return {
    keep: list.slice(0, retentionCount),
    prune: list.slice(retentionCount),
  };
}

module.exports = { DEFAULT_RETENTION_COUNT, retentionCountFromEnv, planRetention };
