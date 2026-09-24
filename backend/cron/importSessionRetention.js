"use strict";

// IMP-001-T01(orchestrator) -- uncommitted ImportSession retention sweep.
//
// Modeled directly on cron/receiptRetention.js (OCR-004-T07), which has
// the same risk shape: reclaim a stale, unfinished, not-yet-authoritative
// record after a fixed window. An ImportSession is pure UX scaffolding
// until it is committed -- importTypes.js's own header comment on
// IMPORT_SESSION_RETENTION_HOURS is explicit that nothing of value is
// lost by expiring an uncommitted session; the user just re-uploads.
//
// Unlike receiptRetention.js, this sweep does NOT delete the document --
// it transitions status -> "expired" (a terminal state importTypes.js's
// own state-machine comment already documents as reachable only via this
// sweep, never by the user). Keeping the row/decision history around
// after expiry costs nothing (no blob storage attached, just a bounded
// array of subdocuments) and preserves an audit trail of "this session
// existed and was abandoned" rather than erasing it outright.
//
// isSessionEligibleForRetentionSweep (importTypes.js) is the single
// source of truth for the eligibility rule (status is previewing or
// committing, AND older than IMPORT_SESSION_RETENTION_HOURS) -- see that
// function's own comment for why COMMITTING is swept too, not just
// PREVIEWING: a session that crashed mid-commit (the owning process died
// between winning the CAS and finishing the loop) would otherwise sit in
// "committing" forever, permanently blocking retry (importCommitService's
// CAS treats "committing" as "a concurrent commit is in flight" and
// refuses a second attempt). Sweeping a stale COMMITTING session to
// EXPIRED after the retention window unblocks that user -- they lose the
// stuck session (any rows it DID commit before crashing already exist as
// real Expense documents, unaffected) and can simply re-upload.
//
// Runs once daily at 07:00 -- after accountDeletionJob.js's 03:00,
// staleDeviceCleanup.js's 04:00, exportCleanup.js's 05:00 and
// receiptRetention.js's 06:00 sweeps, keeping these daily jobs staggered
// rather than piling onto the same minute (see server.js for the full
// list of what runs when).
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

    // A global scan across ALL users, same shape as
    // receiptRetention.js's/exportCleanup.js's sweeps -- never scoped to
    // one user. Only previewing/committing sessions are candidates at
    // all (committed and already-expired sessions are excluded at the
    // query level, mirroring isSessionEligibleForRetentionSweep's own
    // early-return checks, so this job never loads a session it could
    // never touch).
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
        // The age check itself is the SAME pure predicate
        // isSessionEligibleForRetentionSweep already documents as the
        // single source of truth, evaluated here in JS (against `now`)
        // rather than as a Mongo date-range filter, since the window is
        // fixed and the candidate set from the query above is already
        // small (bounded by however many sessions are genuinely
        // in-flight at once, not by total historical session volume --
        // committed/expired sessions never re-enter this query).
        if (!isSessionEligibleForRetentionSweep(session, now)) {
          continue;
        }

        // Re-check eligibility atomically at the point of the write --
        // the same "compare-and-swap keyed on the fields that defined
        // eligibility" discipline receiptRetention.js's own
        // findOneAndDelete already uses, applied here to a status
        // transition instead of a delete. Guards against a user
        // resuming/committing this exact session in the seconds between
        // the batch find() above and this item being processed.
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
