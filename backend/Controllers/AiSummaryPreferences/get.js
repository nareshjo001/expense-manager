"use strict";

// AI-001-T05 -- GET /sia/monthly-summary/preferences. Read-only opt-in +
// current-period regeneration-usage view, matching
// Controllers/NotificationPreferences/get.js's own thin-controller shape.
const { getPreference } = require("../../sia/aiSummaryPreferenceService");

const getAiSummaryPreference = async (req, res) => {
  try {
    const preference = await getPreference(req.userId);
    return res.status(200).json({ message: "Success", success: true, data: preference });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { getAiSummaryPreference };
