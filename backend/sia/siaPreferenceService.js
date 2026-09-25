"use strict";

// SIA-001-T06 -- per-user SIA enable/disable. Same thin get/set-preference
// shape as aiSummaryPreferenceService.js/notificationPreferenceService.js,
// but an OPT-OUT control rather than opt-in: SIA is enabled by default, so
// a user who never touches the toggle (the overwhelming majority) needs no
// document at all -- getPreference()/isEnabledForUser() both treat "no
// saved document" and "document with enabled !== false" identically.
const SiaPreference = require("../models/SiaPreference");

// The full view a settings screen needs -- always a complete {enabled}
// shape, never a partial document a caller has to fill gaps in itself.
async function getPreference(userId) {
  const doc = await SiaPreference.findOne({ userId }).lean();
  return { enabled: doc?.enabled !== false };
}

// The single boolean check the /sia/ask enforcement gate needs, without
// unwrapping getPreference()'s fuller shape. Callers that hit a DB error
// decide their own fail-open/fail-closed posture (see ask.js's
// safeIsSiaEnabledForUser) -- this function itself never swallows errors,
// so a caller that genuinely needs to know about a failure still can.
async function isEnabledForUser(userId) {
  const preference = await getPreference(userId);
  return preference.enabled;
}

// Upserts the enabled flag only, matching aiSummaryPreferenceService.
// setOptIn's "single-field upsert, never touches anything else" shape.
async function setEnabled(userId, enabled) {
  if (typeof enabled !== "boolean") {
    return { ok: false, reason: "invalid_enabled" };
  }
  await SiaPreference.findOneAndUpdate(
    { userId },
    { $set: { enabled }, $setOnInsert: { userId } },
    { upsert: true, new: true }
  );
  return { ok: true, preference: await getPreference(userId) };
}

module.exports = {
  getPreference,
  isEnabledForUser,
  setEnabled,
};
