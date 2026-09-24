const mongoose = require("mongoose");

// AI-001-T05 -- one preferences+usage document per user, same
// unique-on-userId, single-document shape NOT-003's NotificationPreference
// already uses (see its own comment for why: the whole thing is always
// read/written together from one settings screen, so there's no access
// pattern that benefits from splitting it).
//
// `optedIn` gates the feature entirely per this feature's outcome
// statement ("Offer an OPT-IN narrative..." --
// workflow/features/P2/AI-001-optional-monthly-ai-summary.md, section 5):
// no summary is ever generated for a user until they explicitly turn this
// on. `regenerationPeriod`/`regenerationCount` track the rolling monthly
// cap aiSummaryPreferenceService.js enforces -- deliberately NOT an
// express-rate-limit sliding window (that's a separate, additional
// defense-in-depth HTTP-level limiter on the route itself, see
// utils/rateLimiter.js's aiSummaryLimiter): a business-rule "N per
// calendar month" cap needs to survive across requests/restarts, which
// only a persisted counter does.
const aiSummaryPreferenceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true,
    unique: true,
  },
  optedIn: {
    type: Boolean,
    default: false,
  },
  // "YYYY-MM" in the app's configured time zone (see periodResolver.js's
  // getZonedYMD) -- the period regenerationCount is counting against.
  // A stored period that doesn't match the CURRENT period means the
  // counter is stale and must be treated as 0 (aiSummaryPreferenceService.
  // js's recordRegeneration() does this reset itself; it is never done via
  // a migration/cron, so a user who never regenerates in a given month
  // never needs a write at all).
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
