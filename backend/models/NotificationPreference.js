const mongoose = require("mongoose");

// NOT-003-T02 -- one preferences document per user. Deliberately a single
// document (unique on userId, like DeviceToken/MerchantCategoryRule's own
// per-user-scoped shapes elsewhere in this codebase) rather than one
// document per type: the whole set is always read together (every push
// send needs the full picture: is this type enabled, what preview mode, is
// quiet hours on) and always written together from one settings screen, so
// there is no real access pattern that benefits from splitting it.
//
// `types` is intentionally Mixed rather than a strictly-typed subdocument
// map: models/Notification.js's own `type` field is deliberately an
// unconstrained string so new notification types never need a schema
// migration (see its inline comment) -- constraining `types` here to
// today's registry would defeat that. Validation of what a caller may
// WRITE into it (known type keys only, `enabled` boolean, `preview` one of
// PREVIEW_MODES) lives in notificationPreferenceService.js instead, the
// same split recurringLifecycleService.js already uses for its own
// business-rule validation (schema stays permissive; the service is the
// gate).
const notificationPreferenceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true,
    // Uniqueness comes from the explicit schema.index() below. Declaring
    // `unique: true` here as well defined the same index twice, which made
    // Mongoose print a plain-text duplicate-index warning on every start
    // (found by scripts/verifyObservability.js, OBS-001-T07).
  },
  // { [notificationType]: { enabled: Boolean, preview: "device"|"generic"|"detailed" } }
  // Never trusted as-is on read -- always merged over
  // defaultPreferencesByType() by notificationPreferenceService.js's
  // effectivePreferences(), so a type registered after this document was
  // last saved still resolves to its registry default rather than
  // `undefined`.
  types: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({}),
  },
  // Quiet hours are a single global window, not per-type -- NOT-003's
  // feature doc describes one quiet-hours setting for the account, and a
  // per-type window would need its own timeZone/start/end trio repeated for
  // every registered type for no expressed requirement.
  quietHours: {
    enabled: { type: Boolean, default: false },
    // "HH:mm", 24h, evaluated in `timeZone` -- see utils/timeZone.js's
    // isWithinQuietHours for exactly how these two are compared (the
    // window may wrap past midnight, e.g. 22:00 -> 07:00).
    start: { type: String, default: "22:00" },
    end: { type: String, default: "07:00" },
    // null -- rather than a hardcoded default string -- means "use the
    // app's configured time zone at evaluation time"
    // (utils/timeZone.js's resolveTimeZone(null) already resolves that),
    // so a later change to APP_TIME_ZONE changes behavior for every user
    // who never explicitly chose their own zone, without a backfill.
    timeZone: { type: String, default: null },
  },
}, { timestamps: true });

// DAT-002-T03 convention (see DeviceToken.js/Notification.js's matching
// comments) -- the only real query pattern is a point lookup by userId
// (one document per user), which the unique index above already serves;
// no separate non-unique index is needed on top of it.
notificationPreferenceSchema.index({ userId: 1 }, { unique: true });

module.exports = mongoose.model("NotificationPreference", notificationPreferenceSchema);
