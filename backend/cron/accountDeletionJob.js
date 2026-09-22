"use strict";

const cron = require("node-cron");
// PRV-001-T04 (ADR-0007) -- job-level lease so only one server instance
// runs a purge cycle at a time. failOpen is NOT set here, so it stays the
// jobLease.js default of false: unlike recurringJob.js's occurrence-ID
// uniqueness constraint, an account-deletion purge has no independent
// backstop against two instances racing through the SAME user's step
// sequence concurrently, so an unreachable lease coordinator means skip
// this cycle, not run anyway. Skipping costs one day's delay on an already
// 14-day grace period; running twice concurrently is the higher-risk
// outcome for an irreversible operation.
const { runWithLease } = require("../utils/jobLease");
const { runAccountDeletionPurge } = require("../Services/PrivacyServices/accountDeletionOrchestrator");
const { TIER_A_STEPS } = require("../Services/PrivacyServices/accountDeletionTierASteps");
const { TIER_B_STEPS } = require("../Services/PrivacyServices/accountDeletionTierBSteps");
const { logEvent } = require("../utils/logger");

const JOB_NAME = "accountDeletionJob";
const LEASE_TTL_MS = 10 * 60 * 1000;

// PRV-001-T05 -- Tier A's steps run first every purge cycle too, not just
// immediately at request time (accountDeletion.js's requestDeletion): they
// are idempotent, so re-running them here is a genuine safety net for a
// request-time call that failed and was never retried (see
// accountDeletionTierASteps.js's module comment).
//
// PRV-001-T06 -- Tier B's steps (per-collection data deletion, `users`
// deleted last, per ADR-0007) are appended after Tier A's. The combined
// order matters: every Tier A step (session/token/cache cleanup) is safe
// to run against data that still exists, but Tier B's deletes must not run
// before Tier A's -- deleting `users` before revoking sessions, for
// instance, would leave an active session for an account that no longer
// exists. purgeUser() runs this whole list strictly in order and stops at
// the first failing step (see accountDeletionOrchestrator.js), so a
// Tier A failure correctly blocks Tier B from starting that cycle rather
// than silently skipping ahead to real data deletion.
const DELETION_STEPS = [...TIER_A_STEPS, ...TIER_B_STEPS];

cron.schedule("0 3 * * *", async () => {
  await runWithLease(JOB_NAME, LEASE_TTL_MS, runDeletionJob, { failOpen: false });
});

async function runDeletionJob(lease) {
  try {
    console.log("Account deletion purge cron running:", new Date());

    if (DELETION_STEPS.length === 0) {
      logEvent({ level: "info", scope: "account-deletion-job", event: "no_steps_configured" });
      return;
    }

    const results = await runAccountDeletionPurge({ steps: DELETION_STEPS, lease });

    for (const result of results) {
      if (!result.ok) {
        logEvent({
          level: "error",
          scope: "account-deletion-job",
          event: "purge_step_failed",
          userId: String(result.userId),
          failedStep: result.failedStep,
          errorMessage: result.error,
        });
      } else {
        logEvent({
          level: "info",
          scope: "account-deletion-job",
          event: "purge_completed",
          userId: String(result.userId),
        });
      }
    }
  } catch (err) {
    console.error("Account deletion purge cron failed:", err && err.message);
  }
}

module.exports = { runDeletionJob, DELETION_STEPS };
