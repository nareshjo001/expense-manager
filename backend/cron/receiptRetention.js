"use strict";

// Unlinked receipt retention sweep. js).
const cron = require("node-cron");
const Receipt = require("../models/Receipt");
const { RECEIPT_UNLINKED_RETENTION_DAYS } = require("../utils/receiptLifecycle");
// Js -- built in parallel by another OCR-004 task. e.
const { deleteReceiptObject } = require("../Services/ReceiptServices/receiptStorageAdapter");
const { runWithLease } = require("../utils/jobLease");
const { logEvent } = require("../utils/logger");

const JOB_NAME = "receiptRetention";
const LEASE_TTL_MS = 5 * 60 * 1000;
const RETENTION_MS = RECEIPT_UNLINKED_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Js, which is why THAT job fails closed) -- a missed cycle during a lease-coordinator outage just leaves an orphaned receipt sitting around one extra day, never a correctness problem.
cron.schedule("0 6 * * *", async () => {
  await runWithLease(JOB_NAME, LEASE_TTL_MS, runReceiptRetentionJob, { failOpen: true });
});

async function runReceiptRetentionJob(lease) {
  try {
    console.log("Receipt retention cron running:", new Date());

    const now = new Date();
    const cutoff = new Date(now.getTime() - RETENTION_MS);

    // Js's sweeps, not scoped to one user.
    const candidates = await Receipt.find({
      linkedExpenseId: null,
      uploadedAt: { $lte: cutoff },
    });

    let deletedCount = 0;
    let storageDeleteFailedCount = 0;
    let recheckSkippedCount = 0;

    for (const receipt of candidates) {
      // Stop between items once this instance can no longer prove it
      // holds the lease -- same rule as exportCleanup.js/retryPush.js.
      if (lease && typeof lease.isHeld === "function" && !lease.isHeld()) {
        console.warn("Receipt retention cron: lease lost mid-run, stopping early.");
        break;
      }

      try {
        // Js uses for its file delete, and for the same reason: deleting the DB record first and then failing to delete the blob would orphan bytes this job could never find again (nothing still points at them).
        try {
          await deleteReceiptObject(receipt.storageKey);
        } catch (storageErr) {
          // DeleteReceiptObject is documented idempotent for "already gone" -- that case resolves, it does not throw.
          storageDeleteFailedCount += 1;
          logEvent({
            level: "error",
            scope: "receipt-retention",
            event: "storage_delete_failed",
            receiptId: String(receipt._id),
            errorCode: (storageErr && storageErr.code) || null,
          });
          continue;
        }

        // Race-condition guard (point 4 of this task's spec): a user can link -- or unlink -- a receipt in the seconds between the batch find() above and this item being processed, especially deep into a large batch.
        const removed = await Receipt.findOneAndDelete({
          _id: receipt._id,
          linkedExpenseId: null,
          uploadedAt: { $lte: cutoff },
        });

        if (!removed) {
          recheckSkippedCount += 1;
          continue;
        }

        deletedCount += 1;
      } catch (itemErr) {
        // Defensive: an unexpected failure anywhere else in this item's
        // handling must not abort the sweep for the rest of the batch.
        storageDeleteFailedCount += 1;
        logEvent({
          level: "error",
          scope: "receipt-retention",
          event: "item_failed",
          receiptId: String(receipt._id),
          errorCode: (itemErr && itemErr.code) || null,
        });
      }
    }

    logEvent({
      level: "info",
      scope: "receipt-retention",
      event: "swept",
      candidateCount: candidates.length,
      deletedCount,
      storageDeleteFailedCount,
      recheckSkippedCount,
    });
  } catch {
    console.error("Receipt retention cron failed.");
  }
}

module.exports = { runReceiptRetentionJob };
