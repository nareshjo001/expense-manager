const cron = require("node-cron");
const Notification = require("../models/Notification");
const { sendPush } = require("../Services/push.service");
// REC-001 -- job-level lease so two instances never both re-send the same
// failed push notification.
//
// REC-001-T04 (2026-09-09): this loop now HAS a per-item claim -- see
// claimNotification() below. The previous comment here recorded that it did
// not, which made the job-level lease the only thing standing between a
// Redis outage and a user receiving the same push twice.
//
// REC-001-T03: this job fails CLOSED. A skipped cycle just means the
// notifications stay queued for the next run fifteen minutes later; a
// duplicated cycle means a user's phone buzzes twice for one event, which
// cannot be undone.
const { runWithLease } = require("../utils/jobLease");

const JOB_NAME = "retryPush";
const LEASE_TTL_MS = 5 * 60 * 1000;

cron.schedule("*/15 * * * *", async () => {
  await runWithLease(JOB_NAME, LEASE_TTL_MS, runRetryPushJob);
});

// REC-001-T04 -- item-level claim. Atomically moves ONE notification out of
// the "eligible for retry" set before it is sent, using a compare-and-swap on
// the fields that define eligibility: the filter pins the exact retryCount
// the reader saw, and the update increments it. Two workers racing the same
// document therefore cannot both match -- the loser's filter no longer
// matches the incremented count and findOneAndUpdate returns null.
//
// Deliberately built from EXISTING fields rather than adding claimedBy /
// claimedAt. New schema fields would need a migration and a backfill under
// DAT-003's rules, and they would encode a lease a crashed worker could hold
// past its usefulness. Incrementing retryCount up front is self-healing
// instead: a worker that dies after claiming has already pushed nextRetryAt
// forward, so the item simply becomes eligible again on a later cycle and is
// bounded by the same retryCount < 3 ceiling as everything else.
//
// The cost of this design, stated plainly: a send that fails for a transient
// reason still consumes one of the three attempts, because the attempt is
// counted before the outcome is known. That is the correct direction to err
// -- counting after the fact is what allows a duplicate send.
const RETRY_BACKOFF_MS = 5 * 60 * 1000;

async function claimNotification(notif, now) {
  return Notification.findOneAndUpdate(
    {
      _id: notif._id,
      pushStatus: "failed",
      retryCount: notif.retryCount,
      nextRetryAt: { $lte: now },
    },
    {
      $inc: { retryCount: 1 },
      $set: { nextRetryAt: new Date(Date.now() + RETRY_BACKOFF_MS) },
    },
    { new: true }
  );
}

async function runRetryPushJob(lease) {

  try {

    console.log("Retry push cron running:", new Date());

    // Get current time
    const now = new Date();

    // Find failed notifications eligible for retry
    const failedNotifications = await Notification.find({
      pushStatus: "failed",
      retryCount: { $lt: 3 }, // max 3 retries
      nextRetryAt: { $lte: now }
    });

    // Process each failed notification
    for (const notif of failedNotifications) {

      // REC-001-T03 -- stop between items once this instance can no longer
      // prove it holds the lease. Continuing would mean sending pushes
      // alongside whichever instance took the lease over.
      if (lease && typeof lease.isHeld === "function" && !lease.isHeld()) {
        console.warn("Retry push cron: lease lost mid-run, stopping early.");
        break;
      }

      // REC-001-T04 -- claim before sending. If another worker got there
      // first this returns null and we skip: the send belongs to them.
      const claimed = await claimNotification(notif, now);
      if (!claimed) continue;

      // Attempt to resend push notification
      const result = await sendPush(
        notif.userId.toString(),
        notif.title,
        notif.message
      );

      if (result.success) {
        // retryCount was already incremented by the claim; only the terminal
        // state is recorded here.
        await Notification.updateOne(
          { _id: notif._id },
          {
            pushStatus: "sent",
            nextRetryAt: null
          }
        );
      }
      // On failure nothing more is written: the claim already incremented
      // retryCount and scheduled the next attempt, so the item ages out at
      // the retryCount < 3 ceiling on its own.
    }

  } catch {
    // Log unexpected retry cron errors
    console.error("Retry cron failed.");
  }

}
