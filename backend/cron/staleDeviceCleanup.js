"use strict";

// NOT-003-T06 -- stale device-token sweep. A device token that is never
// explicitly revoked (uninstalled app, browser data cleared without
// visiting the app first, a phone that changed owners) would otherwise sit
// in DeviceToken forever, since the only OTHER cleanup path
// (push.service.js's FCM-error deletion) only fires on a send that
// actually targets it -- a user who stops opening the app stops generating
// sends at all, so that path never runs for exactly the tokens most likely
// to be genuinely stale.
//
// "Stale" here means unrefreshed, not unused: useWebPush.js's registerToken
// re-registers (upserts, refreshing updatedAt via DeviceToken's
// `timestamps: true`) on every app load where push permission is already
// granted -- so a token's updatedAt only stops advancing once the user
// truly stops opening the app on that device. A fixed calendar cutoff on
// that field is therefore a reasonable staleness signal without needing a
// separate "lastSeenAt" field/migration.
const cron = require("node-cron");
const DeviceToken = require("../models/DeviceToken");
const { runWithLease } = require("../utils/jobLease");
const { logEvent } = require("../utils/logger");

const JOB_NAME = "staleDeviceCleanup";
const LEASE_TTL_MS = 5 * 60 * 1000;
const STALE_AFTER_DAYS = 90;
const STALE_AFTER_MS = STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;

// Deleting a stale token is NOT security/privacy-irreversible the way
// account deletion is (PRV-001/accountDeletionJob.js) -- the device simply
// re-registers next time it opens the app with push permission granted, at
// which point a fresh document is created. So this job fails OPEN like
// recurringJob.js: a missed cycle during a lease-coordinator outage just
// means stale tokens linger one more day, not a correctness problem.
cron.schedule("0 4 * * *", async () => {
  await runWithLease(JOB_NAME, LEASE_TTL_MS, runStaleDeviceCleanup, { failOpen: true });
});

async function runStaleDeviceCleanup() {
  try {
    const cutoff = new Date(Date.now() - STALE_AFTER_MS);
    const result = await DeviceToken.deleteMany({ updatedAt: { $lt: cutoff } });
    logEvent({
      level: "info",
      scope: "stale-device-cleanup",
      event: "swept",
      deletedCount: result.deletedCount || 0,
    });
  } catch {
    console.error("Stale device cleanup cron failed.");
  }
}

module.exports = { runStaleDeviceCleanup, STALE_AFTER_DAYS };
