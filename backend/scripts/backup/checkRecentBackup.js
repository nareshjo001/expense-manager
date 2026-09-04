"use strict";

// OPS-002-T03 -- the real seam backend/migrations/environmentGate.js's
// checkRecentBackupExists() delegates to. Reads the configured backup
// destination's manifests (never touches Mongo/Redis itself) and checks
// whether the newest one is within the freshness window. Fails closed
// (returns false) on literally any error -- missing destination,
// unreadable directory, corrupt manifest, no manifests at all -- because
// this function's only job is to answer "is it SAFE to assume a recent
// backup exists," and "I couldn't tell" must mean "no."
const { resolveDestination } = require("./destination");

// ADR-0005's RPO is <=24h daily cadence. The freshness window here is
// intentionally wider than 24h (not equal to it) to tolerate ordinary
// scheduling jitter -- a backup cron that runs at 02:00 UTC daily and a
// migration invoked at 01:55 UTC the next day is still "yesterday's
// backup," not a missed one; 30h gives ~6h of slack past one cadence
// period before this starts (correctly) refusing.
const DEFAULT_MAX_AGE_HOURS = 30;

function maxAgeHoursFromEnv(env = process.env) {
  const raw = env.BACKUP_FRESHNESS_MAX_AGE_HOURS;
  const parsed = raw !== undefined ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_AGE_HOURS;
}

async function isRecentBackupAvailable({ maxAgeHours, env = process.env, now = () => Date.now() } = {}) {
  const effectiveMaxAgeHours = typeof maxAgeHours === "number" ? maxAgeHours : maxAgeHoursFromEnv(env);
  try {
    const destination = resolveDestination(env);
    const manifests = destination.listManifests();
    if (!Array.isArray(manifests) || manifests.length === 0) return false;

    const newest = manifests[0]; // listManifests() returns newest-first
    const createdAtMs = new Date(newest.createdAt).getTime();
    if (!Number.isFinite(createdAtMs)) return false;

    const ageMs = now() - createdAtMs;
    return ageMs >= 0 && ageMs <= effectiveMaxAgeHours * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

module.exports = { DEFAULT_MAX_AGE_HOURS, maxAgeHoursFromEnv, isRecentBackupAvailable };
