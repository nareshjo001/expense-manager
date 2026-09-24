"use strict";

// PRV-001-T04 (ADR-0007) -- resumable deletion orchestration engine.
//
// Scope: ONLY the orchestration primitives (eligibility query + step
// runner). The real Tier A step logic (session/token revocation, device
// token deletion, recurring-job exclusion) is T05's job and the real Tier B
// step logic (per-collection data deletion, `users` deleted last) is T06's;
// both are injected here as an ordered `steps` array, not defined in this
// file, so this module has nothing to change when T05/T06 land -- and its
// own tests can exercise real control flow (ordering, partial-failure
// handling, lease-loss handling) against fake steps, independent of
// T05/T06's not-yet-built real logic.
//
// Resumability contract: no new step-tracking field is added to `users`.
// Every step MUST be idempotent (delete-if-exists / revoke-if-exists) -- the
// same philosophy cron/retryPush.js's claimNotification() comment documents
// for a different job. A crashed or interrupted run is resumed by the NEXT
// cron cycle simply re-running the full step sequence from the top for any
// user still eligible; steps already completed do no-op work the second
// time. Per ADR-0007, the `users` document itself is always the LAST step,
// so its continued existence with deletionRequestedAt/
// deletionScheduledPurgeAt still set is itself the "not yet fully purged"
// signal the eligibility query below relies on -- there is nothing else to
// track, and nothing else needs to be.

const { UserModel } = require("../../config/Schemas");

// Users whose grace period (ADR-0007: 14 days, deletionScheduledPurgeAt)
// has elapsed and who have not cancelled (cancelling clears both fields --
// see Controllers/AuthControllers/accountDeletion.js's cancelDeletion).
// Selects only the fields the loop needs to drive itself; each step
// re-queries whatever it needs per user, scoped to userId.
async function findUsersEligibleForPurge(now = new Date()) {
  return UserModel.find({
    deletionRequestedAt: { $ne: null },
    deletionScheduledPurgeAt: { $ne: null, $lte: now },
  })
    .select("_id deletionRequestedAt deletionScheduledPurgeAt")
    .lean();
}

// Runs `steps` (an ordered array of { name, run(userId) }) against a single
// user, stopping at the first step that throws or the first point the lease
// is found lost. Steps run strictly in order -- each one may depend on
// every prior step already having completed (e.g. a Tier B data-deletion
// step assuming a Tier A step already revoked write access). A stopped run
// is deliberately NOT retried again within this same call: because every
// step is idempotent, the caller (the batch loop below) simply leaves the
// user eligible and the next scheduled cron cycle retries the whole
// sequence from step 1 -- there is no in-process retry loop here to keep
// this function's own behaviour simple and testable.
//
// Never throws -- a failed step is reported in the return value, not
// propagated, so one user's failure cannot abort a whole batch run.
async function purgeUser(userId, { steps, lease } = {}) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error("purgeUser requires a non-empty ordered `steps` array.");
  }

  const completed = [];
  for (const step of steps) {
    if (lease && typeof lease.isHeld === "function" && !lease.isHeld()) {
      return { ok: false, completed, failedStep: null, error: "lease_lost" };
    }
    try {
      await step.run(userId);
      completed.push(step.name);
    } catch (err) {
      return { ok: false, completed, failedStep: step.name, error: (err && err.message) || String(err) };
    }
  }
  return { ok: true, completed, failedStep: null, error: null };
}

// Drives the full batch: finds every eligible user and purges each one in
// turn, stopping the whole batch early if the lease is lost between users
// (the same between-items lease check cron/retryPush.js already uses). One
// user's step failure is logged via `onUserResult` and the loop moves on to
// the next user -- it does NOT re-attempt that same user again within this
// run, for the same idempotent-resumability reason purgeUser itself does
// not retry: the next scheduled cycle is the retry.
async function runAccountDeletionPurge({ steps, lease, now = new Date(), onUserResult } = {}) {
  const users = await findUsersEligibleForPurge(now);
  const results = [];

  for (const user of users) {
    if (lease && typeof lease.isHeld === "function" && !lease.isHeld()) {
      break;
    }
    const result = await purgeUser(user._id, { steps, lease });
    results.push({ userId: user._id, ...result });
    if (typeof onUserResult === "function") {
      onUserResult(user._id, result);
    }
  }

  return results;
}

module.exports = { findUsersEligibleForPurge, purgeUser, runAccountDeletionPurge };
