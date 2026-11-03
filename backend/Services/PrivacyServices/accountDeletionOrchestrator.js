"use strict";

// T04 (ADR-0007) -- resumable deletion orchestration engine. Scope: ONLY the orchestration primitives (eligibility query + step runner).

const { UserModel } = require("../../config/Schemas");

// Js's cancelDeletion). Selects only the fields the loop needs to drive itself; each step re-queries whatever it needs per user, scoped to use.
async function findUsersEligibleForPurge(now = new Date()) {
  return UserModel.find({
    deletionRequestedAt: { $ne: null },
    deletionScheduledPurgeAt: { $ne: null, $lte: now },
  })
    .select("_id deletionRequestedAt deletionScheduledPurgeAt")
    .lean();
}

// Runs `steps` (an ordered array of { name, run(userId) }) against a single user, stopping at the first step that throws or the first point the lease is found lost.
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

// Js already uses). One user's step failure is logged via `onUserResult` and the loop moves on to the next user -- it does NOT re-attempt that.
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
