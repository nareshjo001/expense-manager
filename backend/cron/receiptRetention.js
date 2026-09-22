"use strict";

// OCR-004-T07 -- unlinked receipt retention sweep.
//
// Scope note: OCR-004's own task breakdown has no dedicated task titled
// "add the retention cron" the way DAT-004 had a T06 for exactly that
// (cron/exportCleanup.js). This build is folded into T07's "retention"
// half, alongside the lifecycle/authorization tests T07's title is more
// obviously about -- a deliberate, disclosed scope call, not an
// oversight.
//
// Modeled directly on cron/exportCleanup.js (DAT-004-T06), which has the
// same risk shape: delete a stale, unlinked, disk/blob-backed record
// after N days. A receipt that is never linked to an expense is just
// clutter, not evidence -- utils/receiptLifecycle.js's own header is
// explicit that a LINKED receipt is only ever removed by an explicit user
// delete or account deletion (PRV-001's Tier B purge, see
// Services/PrivacyServices/accountDeletionTierBSteps.js, which will
// eventually need its own Receipt cleanup step for a full account
// purge -- built separately, not here; this cron is not assumed to be the
// only thing that will ever delete a Receipt document).
//
// Runs once daily -- nobody is actively waiting on a retention sweep, and
// RECEIPT_UNLINKED_RETENTION_DAYS is itself a 90-day window, so daily
// cadence cannot let an eligible receipt overstay by more than about a
// day. Scheduled at 06:00, after accountDeletionJob.js's 03:00,
// staleDeviceCleanup.js's 04:00 and exportCleanup.js's 05:00 sweeps, so
// these daily jobs stay staggered rather than piling onto the same
// minute (see server.js for the full list of what runs when).
const cron = require("node-cron");
const Receipt = require("../models/Receipt");
const { RECEIPT_UNLINKED_RETENTION_DAYS } = require("../utils/receiptLifecycle");
// Services/ReceiptServices/receiptStorageAdapter.js -- built in parallel by
// another OCR-004 task. Required against its documented signature,
// `async deleteReceiptObject(storageKey)`, idempotent (deleting an
// already-gone GridFS object is a successful no-op -- i.e. that case
// resolves, it never throws).
const { deleteReceiptObject } = require("../Services/ReceiptServices/receiptStorageAdapter");
const { runWithLease } = require("../utils/jobLease");
const { logEvent } = require("../utils/logger");

const JOB_NAME = "receiptRetention";
const LEASE_TTL_MS = 5 * 60 * 1000;
const RETENTION_MS = RECEIPT_UNLINKED_RETENTION_DAYS * 24 * 60 * 60 * 1000;

// Deleting an unlinked receipt is NOT security/privacy-irreversible the
// way account deletion is (PRV-001/accountDeletionJob.js, which is why
// THAT job fails closed) -- a missed cycle during a lease-coordinator
// outage just leaves an orphaned receipt sitting around one extra day,
// never a correctness problem. Same posture, same reasoning, as
// exportCleanup.js/staleDeviceCleanup.js, both of which opt into
// failOpen too.
cron.schedule("0 6 * * *", async () => {
  await runWithLease(JOB_NAME, LEASE_TTL_MS, runReceiptRetentionJob, { failOpen: true });
});

async function runReceiptRetentionJob(lease) {
  try {
    console.log("Receipt retention cron running:", new Date());

    const now = new Date();
    const cutoff = new Date(now.getTime() - RETENTION_MS);

    // The exact query pattern models/Receipt.js's { linkedExpenseId: 1,
    // uploadedAt: 1 } index exists for -- a global scan across ALL users,
    // same shape as exportCleanup.js's/staleDeviceCleanup.js's sweeps, not
    // scoped to one user. This is the SAME rule
    // utils/receiptLifecycle.js's isEligibleForRetentionSweep() documents
    // as the single source of truth (unlinked AND older than the
    // retention window) expressed as a Mongo filter instead of a
    // per-document JS check, so this job never has to load every Receipt
    // into memory to test it.
    //
    // Note on the boundary: isEligibleForRetentionSweep() treats a
    // receipt as eligible only once it is STRICTLY older than the window
    // (ageMs > retentionMs), i.e. uploadedAt < cutoff. This query uses
    // $lte (uploadedAt AT OR before cutoff), which is inclusive of the
    // exact-millisecond boundary. That sub-millisecond difference cannot
    // matter in practice for a job that runs once a day against
    // day-granularity upload timestamps, so it is left as $lte to keep
    // this query's shape identical to exportCleanup.js's; the pure
    // function's exact-boundary contract is unit-tested directly in
    // tests/receiptLifecycle.test.js.
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
        // Storage delete FIRST, before touching the Receipt document --
        // same ordering exportCleanup.js uses for its file delete, and
        // for the same reason: deleting the DB record first and then
        // failing to delete the blob would orphan bytes this job could
        // never find again (nothing still points at them). Deleting the
        // blob first and then failing to delete the doc just means
        // tomorrow's sweep re-reads the same (now-empty) storageKey and
        // deleteReceiptObject's own idempotency makes that retry a safe
        // no-op.
        try {
          await deleteReceiptObject(receipt.storageKey);
        } catch (storageErr) {
          // deleteReceiptObject is documented idempotent for "already
          // gone" -- that case resolves, it does not throw. So ANY throw
          // here is a genuine, non-idempotent-covered failure (unlike
          // exportCleanup.js's fs.unlink, which has to distinguish ENOENT
          // from a real error by code). Leave the document untouched so
          // tomorrow's sweep retries the same delete, and move on.
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

        // Race-condition guard (point 4 of this task's spec): a user can
        // link -- or unlink -- a receipt in the seconds between the
        // batch find() above and this item being processed, especially
        // deep into a large batch. Trusting the batch snapshot and doing
        // a plain deleteOne({ _id: receipt._id }) here could delete a
        // receipt that became real financial evidence (got linked to an
        // expense) moments ago. Instead, re-check the SAME eligibility
        // filter atomically at the point of deletion via
        // findOneAndDelete -- the identical "re-check the condition
        // atomically at the point of action" discipline
        // retryPush.js's claimNotification() and exportGeneration.js's
        // claim pattern already use elsewhere in this codebase (a
        // compare-and-swap keyed on the same fields that defined
        // eligibility), just applied to a delete instead of a status
        // transition. If the receipt no longer matches (it was linked in
        // the interim), findOneAndDelete returns null and the document is
        // left alone -- it is now real evidence, not clutter.
        //
        // Residual trade-off, stated plainly: the storage delete above
        // already ran against the storageKey read at batch-find time, so
        // in the narrow window where a relink happens between that read
        // and this check, the blob is already gone even though the
        // document survives. That is the accepted cost of the ordering
        // above (storage-first, to avoid leaking an unreferenced blob on
        // a storage-delete failure) combined with this CAS-guarded
        // document delete (to avoid ever removing a receipt that is now
        // linked). Closing that last sliver would need a stronger claim
        // primitive than this schema currently has (e.g. a claimedAt
        // field, the way Notification.retryCount is used for retryPush's
        // claim) -- out of scope for this cron, which only owns
        // cron/receiptRetention.js.
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
