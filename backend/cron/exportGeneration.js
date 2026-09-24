"use strict";

// DAT-004-T0X -- generates queued financial exports. A synchronous (small)
// export never creates an ExportRequest at all (see utils/exportTypes.js's
// SYNC_ROW_LIMIT); this job is the ONLY thing that turns a queued one into
// a downloadable file.
//
// Runs every 2 minutes, not once a day like accountDeletionJob.js/
// staleDeviceCleanup.js -- a user who queued a large export is actively
// waiting on it, so this job's whole reason to exist is to not make them
// wait a day for the next cycle. cron/exportCleanup.js (a separate job, not
// this one) owns the later expiry sweep that deletes a "ready" export's
// file once EXPORT_EXPIRY_HOURS has passed -- this job only ever produces
// a file, never removes one.
const cron = require("node-cron");
const fs = require("fs/promises");
const path = require("path");
const ExportRequest = require("../models/ExportRequest");
const { generateExportPayload } = require("../Services/ExportServices/exportGenerationService");
const { EXPORT_STATUSES, EXPORT_EXPIRY_HOURS, buildExportFileName } = require("../utils/exportTypes");
const { runWithLease } = require("../utils/jobLease");
const { logEvent } = require("../utils/logger");

const JOB_NAME = "exportGeneration";
const LEASE_TTL_MS = 5 * 60 * 1000;
const EXPORTS_DIR = path.join(__dirname, "..", "generated-exports");

// This job has NO independent backstop against two instances both
// generating the SAME export request concurrently other than the lease
// plus the per-item claim below -- unlike staleDeviceCleanup.js's
// idempotent deleteMany, writing the same file twice from two racing
// generations is wasted work at best and a corrupted partial write at
// worst if they overlap on the same path. failOpen stays the jobLease.js
// default of false: a Redis outage means this cycle is skipped, not run
// twice.
cron.schedule("*/2 * * * *", async () => {
  await runWithLease(JOB_NAME, LEASE_TTL_MS, runExportGenerationJob, { failOpen: false });
});

// Per-item claim, the same compare-and-swap shape as retryPush.js's
// claimNotification: the filter re-checks status is still "queued" at
// claim time, so two instances racing the same document cannot both win --
// the loser's findOneAndUpdate returns null and it is skipped, exactly
// like the notification retry loop's claim.
async function claimExportRequest(requestId) {
  return ExportRequest.findOneAndUpdate(
    { _id: requestId, status: EXPORT_STATUSES.QUEUED },
    { $set: { status: EXPORT_STATUSES.PROCESSING } },
    { new: true }
  );
}

// Sanitized failure message -- never the raw Error object or its stack,
// matching Services/push.service.js's convention of never logging or
// storing err.message for anything that could leak internals. errorMessage
// is a field a user can eventually see on their own export request, so it
// gets the same treatment as a log line, not less.
const GENERIC_FAILURE_MESSAGE = "Export generation failed";

async function runExportGenerationJob(lease) {
  try {
    console.log("Export generation cron running:", new Date());

    const queued = await ExportRequest.find({ status: EXPORT_STATUSES.QUEUED });

    for (const request of queued) {
      // Stop between items once this instance can no longer prove it holds
      // the lease -- same rule as retryPush.js: continuing would mean
      // generating exports alongside whichever instance took the lease
      // over.
      if (lease && typeof lease.isHeld === "function" && !lease.isHeld()) {
        console.warn("Export generation cron: lease lost mid-run, stopping early.");
        break;
      }

      const claimed = await claimExportRequest(request._id);
      if (!claimed) continue; // another instance claimed it first

      try {
        const { content, rowCount } = await generateExportPayload({
          userId: claimed.userId,
          domain: claimed.domain,
          format: claimed.format,
          dateFrom: claimed.dateFrom,
          dateTo: claimed.dateTo,
        });

        await fs.mkdir(EXPORTS_DIR, { recursive: true });
        const filePath = path.join(EXPORTS_DIR, `${claimed.downloadToken}.${claimed.format}`);
        await fs.writeFile(filePath, content, "utf8");

        const readyAt = new Date();
        const expiresAt = new Date(readyAt.getTime() + EXPORT_EXPIRY_HOURS * 60 * 60 * 1000);

        await ExportRequest.updateOne(
          { _id: claimed._id },
          {
            $set: {
              status: EXPORT_STATUSES.READY,
              filePath,
              fileName: buildExportFileName(claimed.domain, claimed.format, readyAt),
              rowCount,
              sizeBytes: Buffer.byteLength(content, "utf8"),
              readyAt,
              expiresAt,
              errorMessage: null,
            },
          }
        );

        logEvent({
          level: "info",
          scope: "export-generation",
          event: "export_ready",
          requestId: String(claimed._id),
          rowCount,
        });
      } catch (err) {
        // Defensive: TOO_MANY_ROWS (and any other generation error) should
        // not normally reach here, since the request-creation step already
        // calls countExportRows before ever queuing this request -- but
        // generateExportPayload re-checks internally too (see its own
        // module comment), so a request that somehow slipped through still
        // fails safely, as "failed" with a sanitized message, instead of
        // being left stuck at "processing" or silently writing a truncated
        // file.
        await ExportRequest.updateOne(
          { _id: claimed._id },
          { $set: { status: EXPORT_STATUSES.FAILED, errorMessage: GENERIC_FAILURE_MESSAGE } }
        );
        logEvent({
          level: "error",
          scope: "export-generation",
          event: "export_failed",
          requestId: String(claimed._id),
          errorCode: (err && err.code) || null,
        });
      }
    }
  } catch {
    console.error("Export generation cron failed.");
  }
}

module.exports = { runExportGenerationJob };
