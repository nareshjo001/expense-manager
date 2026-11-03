"use strict";

// T01(orchestrator) -- uncommitted ImportSession retention sweep.
const cron = require("node-cron");
const ImportSession = require("../models/ImportSession");
const {
  IMPORT_SESSION_STATUSES,
  isSessionEligibleForRetentionSweep,
} = require("../utils/importTypes");
const { runWithLease } = require("../utils/jobLease");
const { logEvent } = require("../utils/logger");

const JOB_NAME = "importSessionRetention";
const LEASE_TTL_MS = 5 * 60 * 1000;

cron.schedule("0 7 * * *", async () => {
  await runWithLease(JOB_NAME, LEASE_TTL_MS, runImportSessionRetentionJob, { failOpen: true });
});

async function runImportSessionRetentionJob(lease) {
  try {
    console.log("Import session retention cron running:", new Date());

    const now = new Date();

    // Js's sweeps -- never scoped to one user.
    const candidates = await ImportSession.find({
      status: {
        $in: [IMPORT_SESSION_STATUSES.PREVIEWING, IMPORT_SESSION_STATUSES.COMMITTING],
      },
    });

    let expiredCount = 0;
    let recheckSkippedCount = 0;

    for (const session of candidates) {
      // Stop between items once this instance can no longer prove it
      // holds the lease -- same rule as receiptRetention.js/retryPush.js.
      if (lease && typeof lease.isHeld === "function" && !lease.isHeld()) {
        console.warn("Import session retention cron: lease lost mid-run, stopping early.");
        break;
      }

      try {
        // The age check itself is the SAME pure predicate isSessionEligibleForRetentionSweep already documents as the single source of truth, evaluated here in JS (against `now`) rather than as a Mongo date-range filter, since the window is fixed and the candidate set from the query above is already small (bounded by however many sessions are genuinely in-flight at once, not by total historical session volume -- committed/expired sessions never re-enter this query).
        if (!isSessionEligibleForRetentionSweep(session, now)) {
          continue;
        }

        // Js's own findOneAndDelete already uses, applied here to a status transition instead of a delete.
        const removed = await ImportSession.findOneAndUpdate(
          {
            _id: session._id,
            status: {
              $in: [IMPORT_SESSION_STATUSES.PREVIEWING, IMPORT_SESSION_STATUSES.COMMITTING],
            },
            createdAt: session.createdAt,
          },
          { $set: { status: IMPORT_SESSION_STATUSES.EXPIRED } }
        );

        if (!removed) {
          recheckSkippedCount += 1;
          continue;
        }

        expiredCount += 1;
      } catch (itemErr) {
        logEvent({
          level: "error",
          scope: "import-session-retention",
          event: "item_failed",
          sessionId: String(session._id),
          errorCode: (itemErr && itemErr.code) || null,
        });
      }
    }

    logEvent({
      level: "info",
      scope: "import-session-retention",
      event: "swept",
      candidateCount: candidates.length,
      expiredCount,
      recheckSkippedCount,
    });
  } catch {
    console.error("Import session retention cron failed.");
  }
}

module.exports = { runImportSessionRetentionJob };
