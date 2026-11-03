const mongoose = require("mongoose");

// One preferences document per user.
const notificationPreferenceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true,
    // Index() below. js, OBS-001-T07).
  },
  // Js's effectivePreferences(), so a type registered after this document was last saved still resolves to its registry default rather than `undefined`.
  types: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({}),
  },
  // Quiet hours are a single global window, not per-type -- NOT-003's feature doc describes one quiet-hours setting for the account, and a per-type window would need its own timeZone/start/end trio repeated for every registered type for no expressed requirement.
  quietHours: {
    enabled: { type: Boolean, default: false },
    // G. 22:00 -> 07:00). 22:00 -> 07:00).
    start: { type: String, default: "22:00" },
    end: { type: String, default: "07:00" },
    // Js's resolveTimeZone(null) already resolves that), so a later change to APP_TIME_ZONE changes behavior for every user who never explicitly chose their own zone, without a backfill.
    timeZone: { type: String, default: null },
  },
}, { timestamps: true });

// Js's matching comments) -- the only real query pattern is a point lookup by userId (one document per user), which the unique index above already serves; no separate non-unique index is needed on top of it.
notificationPreferenceSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model("NotificationPreference", notificationPreferenceSchema);
