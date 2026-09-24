"use strict";

// AI-001-T05 -- POST /sia/monthly-summary/generate. The route AI-001-T02's
// deliverable deliberately deferred ("wiring a user-facing endpoint before
// T05's opt-in gate exists would let it run for users who haven't enabled
// it"): this is that gate, now that it exists. Every request must pass
// BOTH checks before any report is read or any LLM is called:
//   1. aiSummaryPreferenceService.recordRegeneration() -- opted-in AND
//      within this month's regeneration cap. A rejected attempt (403/429)
//      never touches reportService or the LLM path, and never consumes a
//      regeneration credit (see recordRegeneration's own contract).
//   2. utils/rateLimiter.js's aiSummaryLimiter, applied at the route level
//      in Routes/sia.routes.js -- a separate, short-window defense-in-depth
//      layer against burst abuse, independent of this monthly business cap.
// generateMonthlySummary({ allowLlm: true }) itself already guarantees a
// safe result either way (LLM-authored when available and valid, the
// deterministic template otherwise) -- this controller never needs its own
// fallback branching.
const reportService = require("../../Services/reportService");
const { recordRegeneration } = require("../../sia/aiSummaryPreferenceService");
const { generateMonthlySummary } = require("../../sia/monthlySummaryService");

const generateAiMonthlySummary = async (req, res) => {
  try {
    const regenResult = await recordRegeneration(req.userId);
    if (!regenResult.allowed) {
      if (regenResult.reasonCode === "NOT_OPTED_IN") {
        return res.status(403).json({
          message: "You need to opt in to the monthly AI summary before generating one.",
          success: false,
          errorCode: "AI_SUMMARY_NOT_OPTED_IN",
        });
      }
      return res.status(429).json({
        message: "You've reached this month's AI summary regeneration limit.",
        success: false,
        errorCode: "AI_SUMMARY_REGENERATION_LIMIT_EXCEEDED",
        data: {
          regenerationsUsed: regenResult.regenerationsUsed,
          regenerationLimit: regenResult.regenerationLimit,
          regenerationsRemaining: regenResult.regenerationsRemaining,
        },
      });
    }

    const report = await reportService.getReport(req.userId);
    const summary = await generateMonthlySummary(report, { allowLlm: true });

    return res.status(200).json({
      message: "Success",
      success: true,
      data: {
        ...summary,
        regenerationsUsed: regenResult.regenerationsUsed,
        regenerationLimit: regenResult.regenerationLimit,
        regenerationsRemaining: regenResult.regenerationsRemaining,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { generateAiMonthlySummary };
