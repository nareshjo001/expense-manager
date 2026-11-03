const cron = require("node-cron");
const Notification = require("../models/Notification");
const { sendPush } = require("../Services/push.service");
// Job-level lease so two instances never both re-send the same failed push notification.
const { runWithLease } = require("../utils/jobLease");

const JOB_NAME = "retryPush";
const LEASE_TTL_MS = 5 * 60 * 1000;

cron.schedule("*/15 * * * *", async () => {
  await runWithLease(JOB_NAME, LEASE_TTL_MS, runRetryPushJob);
});

// Item-level claim. Atomically moves ONE notification out of the "eligible for retry" set before it is sent, using a compare-and-swap on the f.
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

      // Stop between items once this instance can no longer prove it holds the lease.
      if (lease && typeof lease.isHeld === "function" && !lease.isHeld()) {
        console.warn("Retry push cron: lease lost mid-run, stopping early.");
        break;
      }

      // REC-001-T04 -- claim before sending. If another worker got there
      // first this returns null and we skip: the send belongs to them.
      const claimed = await claimNotification(notif, now);
      if (!claimed) continue;

      // Attempt to resend push notification.
      const result = await sendPush(
        notif.userId.toString(),
        notif.title,
        notif.message,
        { type: notif.type }
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
      } else if (result.suppressed) {
        // T03/T04 -- still gated (type disabled, or still inside quiet hours this cycle).
        await Notification.updateOne(
          { _id: notif._id },
          {
            pushStatus: "suppressed",
            nextRetryAt: null
          }
        );
      }
      // On an actual send failure nothing more is written: the claim already incremented retryCount and scheduled the next attempt, so the item ages out at the retryCount < 3 ceiling on its own.
    }

  } catch {
    // Log unexpected retry cron errors
    console.error("Retry cron failed.");
  }

}
