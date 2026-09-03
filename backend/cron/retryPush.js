const cron = require("node-cron");
const Notification = require("../models/Notification");
const { sendPush } = require("../Services/push.service");
// REC-001 -- job-level lease so two instances never both re-send the same
// failed push notification (this loop has no per-item claim of its own).
const { runWithLease } = require("../utils/jobLease");

const JOB_NAME = "retryPush";
const LEASE_TTL_MS = 5 * 60 * 1000;

cron.schedule("*/15 * * * *", async () => {
  await runWithLease(JOB_NAME, LEASE_TTL_MS, runRetryPushJob);
});

async function runRetryPushJob() {

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

      // Attempt to resend push notification
      const result = await sendPush(
        notif.userId.toString(),
        notif.title,
        notif.message
      );

      // If resend successful
      if (result.success) {

        await Notification.updateOne(
          { _id: notif._id },
          {
            pushStatus: "sent",
            retryCount: notif.retryCount + 1,
            nextRetryAt: null
          }
        );

      } else {

        // If resend fails again, schedule next retry
        await Notification.updateOne(
          { _id: notif._id },
          {
            retryCount: notif.retryCount + 1,
            nextRetryAt: new Date(Date.now() + 5 * 60 * 1000)
          }
        );

      }
    }

  } catch {
    // Log unexpected retry cron errors
    console.error("Retry cron failed.");
  }

}
