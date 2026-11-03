"use strict";

// POST /sia/monthly-summary/generate.
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
