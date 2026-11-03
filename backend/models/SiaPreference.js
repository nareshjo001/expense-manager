const mongoose = require("mongoose");

// Js. `enabled` gates the core SIA "ask" feature per-user.
const siaPreferenceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true,
    // Index() below. js, OBS-001-T07).
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
