"use strict";

// T05 (ADR-0007 Tier A) -- immediate-effect deletion steps: session revocation, device-token deletion, Redis cache clearing.

const { revokeAllSessions } = require("../AuthServices/session.service");
const DeviceToken = require("../../models/DeviceToken");
const { clearUserExpenseCache } = require("../../utils/expenseCache");
const reportCache = require("../../cache/reportCache");
const { logEvent } = require("../../utils/logger");

async function revokeSessionsStep(userId) {
  await revokeAllSessions(userId);
}

async function deleteDeviceTokensStep(userId) {
  await DeviceToken.deleteMany({ userId });
}

async function clearCachesStep(userId) {
  // Js already catch and log their own internal Redis errors rather than throwing -- there is nothing for this step to catch on top of that, it simply awaits both.
  await clearUserExpenseCache(userId);
  await reportCache.invalidate(userId);
}

// Js's purgeUser() expects ({ name, run(userId) }).
const TIER_A_STEPS = [
  { name: "revoke-sessions", run: revokeSessionsStep },
  { name: "delete-device-tokens", run: deleteDeviceTokensStep },
  { name: "clear-caches", run: clearCachesStep },
];

// Best-effort immediate execution at request-acceptance time.
async function runTierAImmediate(userId) {
  for (const step of TIER_A_STEPS) {
    try {
      await step.run(userId);
    } catch (err) {
      logEvent({
        level: "error",
        scope: "account-deletion-tier-a",
        event: "immediate_step_failed",
        userId: String(userId),
        step: step.name,
        errorMessage: (err && err.message) || String(err),
      });
    }
  }
}

module.exports = {
  TIER_A_STEPS,
  runTierAImmediate,
  revokeSessionsStep,
  deleteDeviceTokensStep,
  clearCachesStep,
};
