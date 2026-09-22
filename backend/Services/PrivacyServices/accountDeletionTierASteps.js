"use strict";

// PRV-001-T05 (ADR-0007 Tier A) -- immediate-effect deletion steps: session
// revocation, device-token deletion, Redis cache clearing. Each function
// here is idempotent (safe to call zero, one, or many times against the
// same userId), which is what lets it be used TWICE by design:
//
//   1. Immediately, best-effort, right after a deletion request is
//      accepted (Controllers/AuthControllers/accountDeletion.js's
//      requestDeletion) -- ADR-0007: "the moment a re-authenticated
//      deletion request is accepted, regardless of whether the 14-day
//      window later gets cancelled".
//   2. Again, as the first entries in cron/accountDeletionJob.js's
//      DELETION_STEPS list -- the purge cron's idempotent-resumable design
//      (accountDeletionOrchestrator.js) re-runs the FULL step sequence
//      every cycle for any still-eligible user, so this is a genuine safety
//      net: if step 1's immediate, unlease'd, unretried call failed (a
//      Redis blip, a transient DB error), the purge cron still guarantees
//      these run to completion 14 days later, before any Tier B data
//      deletion begins.
//
// "Stop jobs" (recurring-expense exclusion) is deliberately NOT a step
// here: it is not a one-time action against a user's stored data, it's a
// standing per-cycle filter. See cron/recurringJob.js's own query for that
// half of Tier A.

const { revokeAllSessions } = require("../AuthServices/session.service");
const DeviceToken = require("../../models/DeviceToken");
const { clearUserExpenseCache } = require("../../utils/expenseCache");
const reportCache = require("../../cache/reportCache");
const { logEvent } = require("../../utils/logger");

async function revokeSessionsStep(userId) {
  await revokeAllSessions(userId);
}

async function deleteDeviceTokensStep(userId) {
  await DeviceToken.deleteMany({ userId });
}

async function clearCachesStep(userId) {
  // expenseCache.js / reportCache.js already catch and log their own
  // internal Redis errors rather than throwing -- there is nothing for
  // this step to catch on top of that, it simply awaits both.
  await clearUserExpenseCache(userId);
  await reportCache.invalidate(userId);
}

// The ordered Tier A step list, in the exact shape
// accountDeletionOrchestrator.js's purgeUser() expects ({ name,
// run(userId) }). Exported as a single list so both the request-time
// caller and the purge cron import the SAME steps rather than maintaining
// two copies that could drift apart.
const TIER_A_STEPS = [
  { name: "revoke-sessions", run: revokeSessionsStep },
  { name: "delete-device-tokens", run: deleteDeviceTokensStep },
  { name: "clear-caches", run: clearCachesStep },
];

// Best-effort immediate execution at request-acceptance time. Deliberately
// does not use purgeUser/a lease -- a single request-time call needs no
// batch coordination across users -- and deliberately does not let a Tier A
// failure affect the caller's response: the deletion request itself has
// already been durably recorded on `users` by the time this runs, and the
// purge cron's identical step list re-attempts anything that failed here,
// per the module comment above. Never throws; each step's failure is
// logged individually so one failing step does not block the others.
async function runTierAImmediate(userId) {
  for (const step of TIER_A_STEPS) {
    try {
      await step.run(userId);
    } catch (err) {
      logEvent({
        level: "error",
        scope: "account-deletion-tier-a",
        event: "immediate_step_failed",
        userId: String(userId),
        step: step.name,
        errorMessage: (err && err.message) || String(err),
      });
    }
  }
}

module.exports = {
  TIER_A_STEPS,
  runTierAImmediate,
  revokeSessionsStep,
  deleteDeviceTokensStep,
  clearCachesStep,
};
