"use strict";

// PUT /sia/monthly-summary/preferences. js's own "thin controller, service owns the rules" split.
const { setOptIn } = require("../../sia/aiSummaryPreferenceService");

const REASON_MESSAGES = {
  invalid_opted_in: "optedIn must be true or false",
};

const updateAiSummaryPreference = async (req, res) => {
  try {
    const result = await setOptIn(req.userId, req.body?.optedIn);
    if (!result.ok) {
      return res.status(400).json({
        message: REASON_MESSAGES[result.reason] || "Invalid AI summary preference",
        success: false,
        errorCode: (result.reason || "INVALID_PREFERENCE").toUpperCase(),
      });
    }
    return res.status(200).json({ message: "AI summary preference saved", success: true, data: result.preference });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { updateAiSummaryPreference };
