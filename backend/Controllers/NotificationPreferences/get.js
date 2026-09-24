"use strict";

// NOT-003-T02 -- GET /api/notification-preferences. Read-only,
// registry-complete view (see notificationPreferenceService.
// getEffectivePreferences) plus the type registry's own metadata, so the
// settings UI (NOT-003-T05) never has to hardcode labels/descriptions
// separately from what the backend actually knows how to gate.
const { getEffectivePreferences } = require("../../Services/NotificationServices/notificationPreferenceService");
const { NOTIFICATION_TYPE_META } = require("../../utils/notificationTypes");

const getNotificationPreferences = async (req, res) => {
  try {
    const preferences = await getEffectivePreferences(req.userId);
    return res.status(200).json({
      message: "Success",
      success: true,
      data: { ...preferences, typeMeta: NOTIFICATION_TYPE_META },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { getNotificationPreferences };
