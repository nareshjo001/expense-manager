"use strict";

// DAT-003-T02 -- exclusive lock so only one process runs migrations at a
// time. Reuses utils/jobLease.js's low-level Redis primitives
// (acquireLease/releaseLease -- SET NX PX + a release-if-owner Lua
// script) but with the OPPOSITE failure semantics: jobLease.js fails OPEN
// on a Redis outage because the recurring job it protects has its own
// idempotency backstop (an occurrence-ID uniqueness constraint -- see
// that file's header comment). Database migrations generally have no
// such backstop -- an up() that isn't naturally idempotent, run
// concurrently by two instances that both "won" because locking silently
// no-op'd, can corrupt data or throw halfway through. So this module
// fails CLOSED: if Redis is unreachable, migrations refuse to run rather
// than run unprotected. See backend/models/MigrationLedger.js's header
// for why the applied-migrations record itself lives in Mongo, not here.
const { acquireLease, releaseLease } = require("../utils/jobLease");
const { logEvent } = require("../utils/logger");

const LOCK_NAME = "db-migrations";
// 10 minutes -- generous ceiling for a migration batch to finish; also
// the point at which a crashed holder's lock self-clears so a stuck lock
// can never block operators forever.
const DEFAULT_TTL_MS = 10 * 60 * 1000;

class MigrationLockError extends Error {
  constructor(message) {
    super(message);
    this.name = "MigrationLockError";
  }
}

// Acquires the exclusive migration lock. Always throws MigrationLockError
// rather than returning a falsy value -- both "another process already
// holds it" and "Redis is unreachable" mean the same thing to a caller:
// do not proceed.
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

// Releases a previously-acquired lock. Delegates to jobLease.js's
// release-if-owner script so a slow/expired holder can never delete a
// different process's legitimately re-acquired lock. Never throws, same
// as releaseLease itself -- release is best-effort, the TTL is the real
// backstop.
async function releaseMigrationLock(owner) {
  await releaseLease(LOCK_NAME, owner);
  logEvent({ level: "info", scope: "migrations", event: "lock_released" });
}

// Runs `fn` while holding the exclusive migration lock. Throws
// MigrationLockError *before* calling `fn` at all if the lock cannot be
// acquired. Always releases on the way out, including when `fn` throws.
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
