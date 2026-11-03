"use strict";

// Js's checkRecentBackupExists() delegates to.
const { resolveDestination } = require("./destination");

// ADR-0005's RPO is <=24h daily cadence.
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
