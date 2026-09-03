"use strict";

// REC-001 -- Redis-backed job-level lease so only one server instance
// executes a given scheduled job body at a time when the backend is
// deployed across multiple instances. Redis is treated as best-effort/
// disposable everywhere else in this codebase (utils/expenseCache.js,
// cache/reportCache.js); consistent with that, a Redis outage here
// degrades to "no cross-instance coordination" (every instance runs the
// job) rather than blocking scheduled work entirely -- financial
// correctness for recurringJob.js does not depend on this lease at all,
// it already has its own occurrence-ID uniqueness constraint as the real
// backstop. This module only reduces duplicate NOTIFICATION sends and
// duplicate job execution work across instances.
const crypto = require("crypto");
const { redisClient } = require("../config/redis");
const { logEvent } = require("./logger");

const LEASE_KEY_PREFIX = "job-lease:";

// Atomically releases a lease only if this owner still holds it -- avoids a
// slow worker's delayed release deleting a DIFFERENT worker's lease that
// legitimately re-acquired the key after the original one already expired.
const RELEASE_IF_OWNER_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

// Attempts to acquire an exclusive, auto-expiring lease for `jobName`.
// Returns an owner token on success, or null if another instance already
// holds it. `ttlMs` bounds how long a crashed holder's lease survives
// before another instance can claim the job (stale-lease recovery).
async function acquireLease(jobName, ttlMs) {
  const owner = crypto.randomUUID();
  const key = `${LEASE_KEY_PREFIX}${jobName}`;
  const result = await redisClient.set(key, owner, { NX: true, PX: ttlMs });
  return result ? owner : null;
}

// Releases the lease only if `owner` still holds it. Never throws --
// releasing early is a pure optimization; the lease's own TTL is the
// actual correctness guarantee if release is skipped or fails.
async function releaseLease(jobName, owner) {
  const key = `${LEASE_KEY_PREFIX}${jobName}`;
  try {
    await redisClient.eval(RELEASE_IF_OWNER_SCRIPT, { keys: [key], arguments: [owner] });
  } catch (err) {
    logEvent({ level: "warn", scope: "job-lease", event: "lease_release_failed", jobName, errorMessage: err && err.message });
  }
}

// Runs `fn` under an exclusive job-level lease. Returns { ran: boolean } so
// callers/tests can assert whether the job body actually executed.
async function runWithLease(jobName, ttlMs, fn) {
  const startedAt = Date.now();
  let owner;

  try {
    owner = await acquireLease(jobName, ttlMs);
  } catch (err) {
    // Redis unavailable -- fail OPEN (run anyway) rather than blocking a
    // scheduled job entirely on an optional coordination dependency.
    logEvent({ level: "warn", scope: "job-lease", event: "lease_acquire_failed", jobName, errorMessage: err && err.message });
    owner = "unavailable";
  }

  if (owner === null) {
    logEvent({ level: "info", scope: "job-lease", event: "lease_skipped", jobName });
    return { ran: false };
  }

  logEvent({ level: "info", scope: "job-lease", event: "lease_acquired", jobName, ownerless: owner === "unavailable" });

  try {
    await fn();
    return { ran: true };
  } finally {
    if (owner !== "unavailable") {
      await releaseLease(jobName, owner);
    }
    logEvent({ level: "info", scope: "job-lease", event: "lease_finished", jobName, durationMs: Date.now() - startedAt });
  }
}

module.exports = { runWithLease, acquireLease, releaseLease };
