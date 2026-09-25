const mongoose = require("mongoose");

// SIA-001-T06 -- one preference document per user, same unique-on-userId,
// single-document shape as AiSummaryPreference.js / NotificationPreference.js.
//
// `enabled` gates the core SIA "ask" feature per-user. Unlike AI-001's
// monthly AI summary (opt-IN, off by default), this is an OPT-OUT control:
// SIA is on by default and stays on until a user explicitly turns it off,
// matching this feature's own framing ("Add per-user AI disable ...
// controls" -- SIA-001, section 11, not "add an opt-in"). No saved
// document, or a missing `enabled` field, both mean enabled -- only an
// explicit `enabled: false` turns SIA off for that user
// (siaPreferenceService.js owns this default-state contract).
const siaPreferenceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true,
    unique: true,
  },
  enabled: {
    type: Boolean,
    default: true,
  },
}, { timestamps: true });

// DAT-002-T03 convention (see NotificationPreference.js / AiSummaryPreference.js's
// matching comment) -- the only real query pattern is a point lookup by userId.
siaPreferenceSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model("SiaPreference", siaPreferenceSchema);
