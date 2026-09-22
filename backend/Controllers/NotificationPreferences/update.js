"use strict";

// NOT-003-T02 -- PUT /api/notification-preferences. Thin HTTP wrapper
// around notificationPreferenceService.savePreferences -- validation and
// status-code mapping live here, matching
// Controllers/RecurringExpenses/lifecycle.js's own split between "thin
// controller, service owns the rules".
const { savePreferences } = require("../../Services/NotificationServices/notificationPreferenceService");

const REASON_MESSAGES = {
  invalid_types: "types must be an object keyed by notification type",
  invalid_type_preference: "Each type's preference must be an object",
  invalid_enabled: "enabled must be true or false",
  invalid_preview: "preview must be one of: device, generic, detailed",
  invalid_quiet_hours: "quietHours must be an object",
  invalid_quiet_hours_enabled: "quietHours.enabled must be true or false",
  invalid_quiet_hours_start: "quietHours.start must be a 24h HH:mm time",
  invalid_quiet_hours_end: "quietHours.end must be a 24h HH:mm time",
  invalid_quiet_hours_time_zone: "quietHours.timeZone must be a valid IANA time zone",
  no_fields_provided: "At least one of types or quietHours must be provided",
};

const updateNotificationPreferences = async (req, res) => {
  try {
    const result = await savePreferences(req.userId, req.body || {});
    if (!result.ok) {
      return res.status(400).json({
        message: REASON_MESSAGES[result.reason] || "Invalid notification preferences",
        success: false,
        errorCode: (result.reason || "INVALID_PREFERENCES").toUpperCase(),
        field: result.field,
      });
    }
    return res.status(200).json({
      message: "Notification preferences saved",
      success: true,
      data: result.preferences,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { updateNotificationPreferences };
