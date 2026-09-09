"use strict";

// REC-001 -- Redis-backed job-level lease so only one server instance
// executes a given scheduled job body at a time when the backend is
// deployed across multiple instances.
//
// REC-001-T03 (2026-09-09) closed two gaps the 2026-09-08 audit recorded.
//
// 1. RENEWAL. The lease previously only expired by TTL, so a job that ran
//    longer than its TTL silently lost exclusivity MID-RUN while still
//    executing -- the worst shape of this bug, because the second instance
//    starts while the first is still writing. runWithLease now heartbeats,
//    extending the TTL on an interval while `fn` runs, and stops the moment
//    ownership is lost. `fn` receives a lease handle so a long loop can ask
//    `lease.isHeld()` between items and stop rather than keep working under
//    a lease it no longer owns.
//
// 2. FAIL-OPEN WAS THE DEFAULT FOR EVERY JOB. A Redis outage made every
//    instance run the job -- exactly the duplicate execution this feature
//    exists to prevent. That trade is only defensible when the job has its
//    OWN idempotency backstop; it was being applied to jobs that have none.
//    Fail-open is now an explicit per-job opt-in (`failOpen: true`) and the
//    default is to SKIP the run when Redis cannot be reached. Skipping a
//    periodic job costs one cycle; double-executing it can double-send
//    notifications or double-write records, and there is no undo for that.
//
// Redis remains disposable elsewhere in this codebase (utils/expenseCache.js,
// cache/reportCache.js) and this module stays consistent with ADR-0002 in
// that a lease is never the ONLY correctness guarantee -- recurringJob.js
// still relies on its occurrence-ID uniqueness constraint as the real
// backstop, which is why it is the one job that opts into failing open.
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

// Extends an existing lease's TTL, but ONLY while this owner still holds it.
// The owner check is what makes renewal safe: if the lease already expired
// and another instance took it, this must not resurrect or steal it -- it
// must report the loss so the caller can stop working. Returns true when the
// TTL was extended, false when this owner no longer holds the key.
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

// Renewals are attempted at a fraction of the TTL so a single failed
// heartbeat (a blip, a slow round-trip) does not immediately cost the lease.
// A third gives two chances to recover before expiry.
const RENEW_DIVISOR = 3;

// Runs `fn` under an exclusive job-level lease. Returns { ran: boolean } so
// callers/tests can assert whether the job body actually executed.
//
// `fn` is called with a lease handle: { isHeld() } -- true while this
// instance still provably owns the lease. Long-running loops should check it
// between items; short jobs can ignore it.
//
// options.failOpen (default FALSE): run the job anyway when Redis cannot be
// reached. Only pass true for a job that is safe to execute twice
// concurrently on its own merits -- i.e. it has its own uniqueness
// constraint or claim. See this file's header.
async function runWithLease(jobName, ttlMs, fn, options = {}) {
  const { failOpen = false } = options;
  const startedAt = Date.now();
  let owner;

  try {
    owner = await acquireLease(jobName, ttlMs);
  } catch (err) {
    if (!failOpen) {
      // Default: treat an unreachable coordinator as "cannot prove
      // exclusivity", and skip. One missed cycle of a periodic job is
      // recoverable; a duplicated one may not be.
      logEvent({ level: "error", scope: "job-lease", event: "lease_acquire_failed_skipped", jobName, errorMessage: err && err.message });
      return { ran: false };
    }
    logEvent({ level: "warn", scope: "job-lease", event: "lease_acquire_failed_ran_anyway", jobName, errorMessage: err && err.message });
    owner = "unavailable";
  }

  if (owner === null) {
    logEvent({ level: "info", scope: "job-lease", event: "lease_skipped", jobName });
    return { ran: false };
  }

  const coordinated = owner !== "unavailable";
  logEvent({ level: "info", scope: "job-lease", event: "lease_acquired", jobName, ownerless: !coordinated });

  // Ownership is tracked explicitly rather than inferred at read time: once
  // a renewal proves the lease is gone, isHeld() must stay false even if a
  // later renewal would succeed, because by then another instance may have
  // already started and this one is no longer the single writer.
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
        // A failed heartbeat is not proof of loss -- the lease may still be
        // held and simply unreachable. Log and let the next attempt decide;
        // if renewals keep failing the TTL expires and the job stops being
        // exclusive, which is the pre-existing behaviour, not a regression.
        logEvent({ level: "warn", scope: "job-lease", event: "lease_renew_failed", jobName, errorMessage: err && err.message });
      }
    }, intervalMs);
    // Never let a heartbeat keep the process alive on its own.
    if (typeof timer.unref === "function") timer.unref();
  }

  try {
    await fn({ isHeld: () => held });
    return { ran: true };
  } finally {
    if (timer) clearInterval(timer);
    if (coordinated && held) {
      await releaseLease(jobName, owner);
    }
    logEvent({ level: "info", scope: "job-lease", event: "lease_finished", jobName, durationMs: Date.now() - startedAt, lostMidRun: coordinated && !held });
  }
}

module.exports = { runWithLease, acquireLease, releaseLease, renewLease };
