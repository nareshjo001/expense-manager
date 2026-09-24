"use strict";

// AI-001-T05 -- PUT /sia/monthly-summary/preferences. Thin HTTP wrapper
// around aiSummaryPreferenceService.setOptIn -- validation/status-code
// mapping here, matching Controllers/NotificationPreferences/update.js's
// own "thin controller, service owns the rules" split. This is the ONLY
// way a user's optedIn flag ever changes -- no other route writes it.
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
