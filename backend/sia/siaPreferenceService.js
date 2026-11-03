"use strict";

// Per-user SIA enable/disable. == false" identically.
const SiaPreference = require("../models/SiaPreference");

// The full view a settings screen needs -- always a complete {enabled}
// shape, never a partial document a caller has to fill gaps in itself.
async function getPreference(userId) {
  const doc = await SiaPreference.findOne({ userId }).lean();
  return { enabled: doc?.enabled !== false };
}

// The single boolean check the /sia/ask enforcement gate needs, without unwrapping getPreference()'s fuller shape.
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
