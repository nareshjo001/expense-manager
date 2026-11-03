"use strict";

// Stale device-token sweep.
const cron = require("node-cron");
const DeviceToken = require("../models/DeviceToken");
const { runWithLease } = require("../utils/jobLease");
const { logEvent } = require("../utils/logger");

const JOB_NAME = "staleDeviceCleanup";
const LEASE_TTL_MS = 5 * 60 * 1000;
const STALE_AFTER_DAYS = 90;
const STALE_AFTER_MS = STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;

// Js) -- the device simply re-registers next time it opens the app with push permission granted, at which point a fresh document is created.
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
