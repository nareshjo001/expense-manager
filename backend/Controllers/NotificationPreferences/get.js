"use strict";

// GET /api/notification-preferences. Read-only, registry-complete view (see notificationPreferenceService.
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
