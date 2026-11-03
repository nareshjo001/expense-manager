"use strict";

const cron = require("node-cron");
// T04 (ADR-0007) -- job-level lease so only one server instance runs a purge cycle at a time.
const { runWithLease } = require("../utils/jobLease");
const { runAccountDeletionPurge } = require("../Services/PrivacyServices/accountDeletionOrchestrator");
const { TIER_A_STEPS } = require("../Services/PrivacyServices/accountDeletionTierASteps");
const { TIER_B_STEPS } = require("../Services/PrivacyServices/accountDeletionTierBSteps");
const { logEvent } = require("../utils/logger");

const JOB_NAME = "accountDeletionJob";
const LEASE_TTL_MS = 10 * 60 * 1000;

// Js's module comment). PRV-001-T06 -- Tier B's steps (per-collection data deletion, `users` deleted last, per ADR-0007) are appended after Ti.
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
