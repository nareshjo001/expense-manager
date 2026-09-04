"use strict";

// OPS-002-T03 -- retention pruning as its own pure, testable function.
// ADR-0005 sets a provisional "35 rolling daily backups" target. Two
// readings of that are possible: "keep the newest 35, delete the rest"
// (count-based) vs. "delete anything older than 35 days" (age-based).
// This module picks COUNT-based retention and documents why:
//
//   - It is exactly what "35 rolling daily backups" says literally --
//     ADR-0005 counts backups, not days.
//   - It degrades safely if a scheduled run is ever missed: an
//     age-based cutoff silently lets the effective backup count drop
//     below 35 whenever there's a gap in the daily cadence, while a
//     count-based cutoff always keeps exactly the newest 35 that exist,
//     regardless of the calendar gaps between them.
//   - It is trivially testable against a fixture list with no
//     dependency on wall-clock "now."
const DEFAULT_RETENTION_COUNT = 35;

function retentionCountFromEnv(env = process.env) {
  const raw = env.BACKUP_RETENTION_COUNT;
  const parsed = raw !== undefined ? Number(raw) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_COUNT;
}

// `manifests` must already be sorted newest-first (manifest.js's
// listManifestsSync does this). Returns which manifests to keep and
// which to prune -- pure, no I/O, so it is fixture-testable without any
// real backup destination.
function planRetention(manifests, retentionCount = DEFAULT_RETENTION_COUNT) {
  const list = Array.isArray(manifests) ? manifests : [];
  return {
    keep: list.slice(0, retentionCount),
    prune: list.slice(retentionCount),
  };
}

module.exports = { DEFAULT_RETENTION_COUNT, retentionCountFromEnv, planRetention };
