"use strict";

// Redis-backed job-level lease so only one server instance executes a given scheduled job body at a time when the backend is deployed across multiple instances.
const crypto = require("crypto");
const { redisClient } = require("../config/redis");
const { logEvent } = require("./logger");
// Job metrics. runWithLease is the one place every scheduled job passes through, so recording here covers all three crons without each having.
const { recordJob } = require("./metrics");

const LEASE_KEY_PREFIX = "job-lease:";

// Atomically releases a lease only if this owner still holds it -- avoids a slow worker's delayed release deleting a DIFFERENT worker's lease that legitimately re-acquired the key after the original one already expired.
const RELEASE_IF_OWNER_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

// Extends an existing lease's TTL, but ONLY while this owner still holds it.
const RENEW_IF_OWNER_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
  return 0
end
`;

async function renewLease(jobName, owner, ttlMs) {
  const key = `${LEASE_KEY_PREFIX}${jobName}`;
  const result = await redisClient.eval(RENEW_IF_OWNER_SCRIPT, {
    keys: [key],
    arguments: [owner, String(ttlMs)],
  });
  return Number(result) === 1;
}

// Attempts to acquire an exclusive, auto-expiring lease for `jobName`.
async function acquireLease(jobName, ttlMs) {
  const owner = crypto.randomUUID();
  const key = `${LEASE_KEY_PREFIX}${jobName}`;
  const result = await redisClient.set(key, owner, { NX: true, PX: ttlMs });
  return result ? owner : null;
}

// Releases the lease only if `owner` still holds it.
async function releaseLease(jobName, owner) {
  const key = `${LEASE_KEY_PREFIX}${jobName}`;
  try {
    await redisClient.eval(RELEASE_IF_OWNER_SCRIPT, { keys: [key], arguments: [owner] });
  } catch (err) {
    logEvent({ level: "warn", scope: "job-lease", event: "lease_release_failed", jobName, errorMessage: err && err.message });
  }
}

// Renewals are attempted at a fraction of the TTL so a single failed heartbeat (a blip, a slow round-trip) does not immediately cost the lease.
const RENEW_DIVISOR = 3;

// Runs `fn` under an exclusive job-level lease. Returns { ran: boolean } so callers/tests can assert whether the job body actually executed.
async function runWithLease(jobName, ttlMs, fn, options = {}) {
  const { failOpen = false } = options;
  const startedAt = Date.now();
  let owner;

  try {
    owner = await acquireLease(jobName, ttlMs);
  } catch (err) {
    if (!failOpen) {
      // Default: treat an unreachable coordinator as "cannot prove exclusivity", and skip.
      logEvent({ level: "error", scope: "job-lease", event: "lease_acquire_failed_skipped", jobName, errorMessage: err && err.message });
      recordJob({ jobName, outcome: "skipped" });
      return { ran: false };
    }
    logEvent({ level: "warn", scope: "job-lease", event: "lease_acquire_failed_ran_anyway", jobName, errorMessage: err && err.message });
    owner = "unavailable";
  }

  if (owner === null) {
    logEvent({ level: "info", scope: "job-lease", event: "lease_skipped", jobName });
    // Skipped is its own outcome, not a failure: losing the lease to another instance is the system working.
    recordJob({ jobName, outcome: "skipped" });
    return { ran: false };
  }

  const coordinated = owner !== "unavailable";
  logEvent({ level: "info", scope: "job-lease", event: "lease_acquired", jobName, ownerless: !coordinated });

  // Ownership is tracked explicitly rather than inferred at read time: once a renewal proves the lease is gone, isHeld() must stay false even if a later renewal would succeed, because by then another instance may have already started and this one is no longer the single writer.
  let held = true;
  let timer = null;

  if (coordinated) {
    const intervalMs = Math.max(1000, Math.floor(ttlMs / RENEW_DIVISOR));
    timer = setInterval(async () => {
      try {
        const stillOurs = await renewLease(jobName, owner, ttlMs);
        if (!stillOurs) {
          held = false;
          clearInterval(timer);
          logEvent({ level: "error", scope: "job-lease", event: "lease_lost", jobName, elapsedMs: Date.now() - startedAt });
        }
      } catch (err) {
        // A failed heartbeat is not proof of loss -- the lease may still be held and simply unreachable.
        logEvent({ level: "warn", scope: "job-lease", event: "lease_renew_failed", jobName, errorMessage: err && err.message });
      }
    }, intervalMs);
    // Never let a heartbeat keep the process alive on its own.
    if (typeof timer.unref === "function") timer.unref();
  }

  let jobOutcome = "success";
  try {
    await fn({ isHeld: () => held });
    return { ran: true };
  } catch (err) {
    // The throw is re-raised untouched; this only classifies the run so a job that starts failing every cycle becomes visible in the snapshot instead of only in whatever the caller happens to log.
    jobOutcome = "failure";
    throw err;
  } finally {
    recordJob({ jobName, outcome: jobOutcome, durationMs: Date.now() - startedAt });
    if (timer) clearInterval(timer);
    if (coordinated && held) {
      await releaseLease(jobName, owner);
    }
    logEvent({ level: "info", scope: "job-lease", event: "lease_finished", jobName, durationMs: Date.now() - startedAt, lostMidRun: coordinated && !held });
  }
}

module.exports = { runWithLease, acquireLease, releaseLease, renewLease };
