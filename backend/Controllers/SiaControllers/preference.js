// SIA-001-T06 -- three thin, authenticated handlers over sia/siaPreferenceService.js
// and sia/sessionService.js's deleteAllSessions: read the caller's own
// SIA enable/disable state, change it, and delete the caller's own SIA
// conversation history independent of full account deletion. Every
// handler uses req.userId (set only by verifyToken, before these run) as
// the sole identity -- matching sessions.js's own convention exactly.
"use strict";

const siaPreferenceService = require("../../sia/siaPreferenceService");
const sessionService = require("../../sia/sessionService");
const { isSessionStoreAvailable } = require("../../sia/sessionStoreAvailability");

const UNAVAILABLE_RESPONSE = {
  success: false,
  message: "SIA is temporarily unavailable.",
};

const REASON_MESSAGES = {
  invalid_enabled: "enabled must be true or false",
};

const getSiaPreference = async (req, res) => {
  try {
    const preference = await siaPreferenceService.getPreference(req.userId);
    return res.status(200).json({ success: true, data: preference });
  } catch (_err) {
    return res.status(503).json(UNAVAILABLE_RESPONSE);
  }
};

const updateSiaPreference = async (req, res) => {
  try {
    const result = await siaPreferenceService.setEnabled(req.userId, req.body?.enabled);
    if (!result.ok) {
      return res.status(400).json({
        success: false,
        message: REASON_MESSAGES[result.reason] || "Invalid SIA preference",
      });
    }
    return res.status(200).json({ success: true, message: "SIA preference saved", data: result.preference });
  } catch (_err) {
    return res.status(503).json(UNAVAILABLE_RESPONSE);
  }
};

// Deletes only conversation history (SiaSession + SiaMessage) -- never the
// enable/disable preference itself, and never touches any other data.
// Fails closed, same as every session-store-dependent path in ask.js,
// when the coordination store isn't reachable -- a partial delete across
// two collections without a healthy store is worse than refusing outright.
const deleteSiaHistory = async (req, res) => {
  try {
    if (!isSessionStoreAvailable()) {
      return res.status(503).json(UNAVAILABLE_RESPONSE);
    }
    const result = await sessionService.deleteAllSessions(req.userId);
    return res.status(200).json({ success: true, message: "SIA history deleted.", data: result });
  } catch (_err) {
    return res.status(503).json(UNAVAILABLE_RESPONSE);
  }
};

module.exports = { getSiaPreference, updateSiaPreference, deleteSiaHistory };
