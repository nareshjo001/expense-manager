const mongoose = require("mongoose");

// One preferences+usage document per user, same unique-on-userId, single-document shape NOT-003's NotificationPreference already uses (see its own comment for why: the whole thing is always read/written together from one settings screen, so there's no access pattern that benefits from splitting it).
const aiSummaryPreferenceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true,
    // Index() below. js, OBS-001-T07).
  },
  optedIn: {
    type: Boolean,
    default: false,
  },
  // Js's getZonedYMD) -- the period regenerationCount is counting against.
  regenerationPeriod: {
    type: String,
    default: null,
  },
  regenerationCount: {
    type: Number,
    default: 0,
  },
}, { timestamps: true });

// DAT-002-T03 convention (see NotificationPreference.js's matching
// comment) -- the only real query pattern is a point lookup by userId.
aiSummaryPreferenceSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model("AiSummaryPreference", aiSummaryPreferenceSchema);
