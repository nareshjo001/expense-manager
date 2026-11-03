"use strict";

// Exclusive lock so only one process runs migrations at a time.
const { acquireLease, releaseLease } = require("../utils/jobLease");
const { logEvent } = require("../utils/logger");

const LOCK_NAME = "db-migrations";
// 10 minutes -- generous ceiling for a migration batch to finish; also the point at which a crashed holder's lock self-clears so a stuck lock can never block operators forever.
const DEFAULT_TTL_MS = 10 * 60 * 1000;

class MigrationLockError extends Error {
  constructor(message) {
    super(message);
    this.name = "MigrationLockError";
  }
}

// Acquires the exclusive migration lock.
async function acquireMigrationLock(ttlMs = DEFAULT_TTL_MS) {
  let owner;
  try {
    owner = await acquireLease(LOCK_NAME, ttlMs);
  } catch (err) {
    logEvent({
      level: "error",
      scope: "migrations",
      event: "lock_acquire_error",
      errorMessage: err && err.message,
    });
    throw new MigrationLockError(
      `Could not acquire the migration lock: Redis is unreachable (${err && err.message}). Migrations refuse to run without a lock.`
    );
  }

  if (owner === null) {
    logEvent({ level: "warn", scope: "migrations", event: "lock_held_by_other" });
    throw new MigrationLockError(
      "Could not acquire the migration lock: another process already holds it."
    );
  }

  logEvent({ level: "info", scope: "migrations", event: "lock_acquired" });
  return owner;
}

// Releases a previously-acquired lock.
async function releaseMigrationLock(owner) {
  await releaseLease(LOCK_NAME, owner);
  logEvent({ level: "info", scope: "migrations", event: "lock_released" });
}

// Runs `fn` while holding the exclusive migration lock. Throws MigrationLockError *before* calling `fn` at all if the lock cannot be acquired.
async function withMigrationLock(fn, ttlMs = DEFAULT_TTL_MS) {
  const owner = await acquireMigrationLock(ttlMs);
  try {
    return await fn();
  } finally {
    await releaseMigrationLock(owner);
  }
}

module.exports = {
  LOCK_NAME,
  DEFAULT_TTL_MS,
  MigrationLockError,
  acquireMigrationLock,
  releaseMigrationLock,
  withMigrationLock,
};
