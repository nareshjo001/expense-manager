"use strict";

// DAT-004-T06 -- expired export sweep. cron/exportGeneration.js (a
// separate job, not this one) is the ONLY thing that produces a "ready"
// export file; this job is the ONLY thing that removes one. A "ready"
// ExportRequest's expiresAt (readyAt + EXPORT_EXPIRY_HOURS, see
// utils/exportTypes.js) is set once, at generation time, and never
// touched again until this sweep either deletes the file and marks the
// request "expired", or leaves it alone because it is not due yet.
//
// Modeled directly on cron/staleDeviceCleanup.js, right down to the
// fail-open/idempotent posture: deleting a generated-export file is NOT
// security/privacy-irreversible the way account deletion is
// (PRV-001/accountDeletionJob.js) -- a user who still wants the data just
// queues a new export. So a missed cycle during a lease-coordinator
// outage just means an already-expired file lingers on disk one more day,
// not a correctness problem, and this job opts into failOpen the same way
// staleDeviceCleanup.js does.
//
// Runs once daily, not every 2 minutes like exportGeneration.js -- nobody
// is actively waiting on an expiry sweep the way a user waits on their own
// export finishing, and EXPORT_EXPIRY_HOURS is itself a 24-hour window, so
// a daily cadence cannot let a "ready" file overstay by more than about a
// day. Scheduled at 05:00, after accountDeletionJob.js's 03:00 sweep and
// staleDeviceCleanup.js's 04:00 sweep, so these daily jobs stay staggered
// rather than piling onto the same minute.
const cron = require("node-cron");
const fs = require("fs/promises");
const ExportRequest = require("../models/ExportRequest");
const { EXPORT_STATUSES } = require("../utils/exportTypes");
const { runWithLease } = require("../utils/jobLease");
const { logEvent } = require("../utils/logger");

const JOB_NAME = "exportCleanup";
const LEASE_TTL_MS = 5 * 60 * 1000;

cron.schedule("0 5 * * *", async () => {
  await runWithLease(JOB_NAME, LEASE_TTL_MS, runExportCleanupJob, { failOpen: true });
});

async function runExportCleanupJob(lease) {
  try {
    console.log("Export cleanup cron running:", new Date());

    const now = new Date();

    // The exact query pattern models/ExportRequest.js's { status: 1,
    // expiresAt: 1 } index exists for.
    const expired = await ExportRequest.find({
      status: EXPORT_STATUSES.READY,
      expiresAt: { $lte: now },
    });

    let deletedCount = 0;
    let alreadyMissingCount = 0;
    let noFilePathCount = 0;
    let deleteFailedCount = 0;

    for (const request of expired) {
      // Stop between items once this instance can no longer prove it
      // holds the lease -- same rule as exportGeneration.js/retryPush.js.
      if (lease && typeof lease.isHeld === "function" && !lease.isHeld()) {
        console.warn("Export cleanup cron: lease lost mid-run, stopping early.");
        break;
      }

      try {
        if (!request.filePath) {
          // Nothing on disk to remove (shouldn't normally happen for a
          // "ready" request, but a request with no filePath has nothing
          // this job can delete) -- skip straight to marking it expired.
          noFilePathCount += 1;
        } else {
          try {
            await fs.unlink(request.filePath);
            deletedCount += 1;
          } catch (unlinkErr) {
            if (unlinkErr && unlinkErr.code === "ENOENT") {
              // Idempotent: the file is already gone (a previous run
              // deleted it and crashed before updating the doc, or it was
              // removed out of band). That is success, not an error.
              alreadyMissingCount += 1;
            } else {
              // A genuine delete failure (e.g. a permission error) -- fail
              // open for THIS item only: log it, leave the request as
              // "ready" untouched, and move on to the rest of the batch.
              // Marking it "expired" with filePath cleared here would
              // orphan a file this job could never find again; leaving it
              // "ready" lets tomorrow's sweep retry the same delete.
              deleteFailedCount += 1;
              logEvent({
                level: "error",
                scope: "export-cleanup",
                event: "delete_failed",
                requestId: String(request._id),
                errorCode: (unlinkErr && unlinkErr.code) || null,
              });
              continue;
            }
          }
        }

        await ExportRequest.updateOne(
          { _id: request._id },
          { $set: { status: EXPORT_STATUSES.EXPIRED, filePath: null } }
        );
      } catch (itemErr) {
        // Defensive: an unexpected failure anywhere else in this item's
        // handling (e.g. the updateOne itself) must not abort the sweep
        // for the rest of the batch either.
        deleteFailedCount += 1;
        logEvent({
          level: "error",
          scope: "export-cleanup",
          event: "item_failed",
          requestId: String(request._id),
          errorCode: (itemErr && itemErr.code) || null,
        });
      }
    }

    logEvent({
      level: "info",
      scope: "export-cleanup",
      event: "swept",
      expiredCount: deletedCount + alreadyMissingCount + noFilePathCount,
      deletedCount,
      alreadyMissingCount,
      noFilePathCount,
      deleteFailedCount,
    });
  } catch {
    console.error("Export cleanup cron failed.");
  }
}

module.exports = { runExportCleanupJob };
