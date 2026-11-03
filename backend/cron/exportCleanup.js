"use strict";

// Expired export sweep. js (a separate job, not this one) is the ONLY thing that produces a "ready" export file; this job is the ONLY thing th.
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
          // Nothing on disk to remove (shouldn't normally happen for a "ready" request, but a request with no filePath has nothing this job can delete) -- skip straight to marking it expired.
          noFilePathCount += 1;
        } else {
          try {
            await fs.unlink(request.filePath);
            deletedCount += 1;
          } catch (unlinkErr) {
            if (unlinkErr && unlinkErr.code === "ENOENT") {
              // Idempotent: the file is already gone (a previous run deleted it and crashed before updating the doc, or it was removed out of band).
              alreadyMissingCount += 1;
            } else {
              // G. a permission error) -- fail open for THIS item only: log it, leave the request as "ready" untouched, and move on to the rest of the batch.
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
        // G. the updateOne itself) must not abort the sweep for the rest of the batch either.
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
