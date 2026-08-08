// SIA session controllers -- Batch 2.
//
// Three thin, authenticated handlers over sia/sessionService.js: list the
// caller's own sessions, list one owned session's messages (paginated),
// and delete one owned session. Every handler uses req.userId (set only by
// Middlewares/Auth.js's verifyToken, which always runs before these in
// Routes/sia.routes.js) as the sole identity -- a client-supplied userId in
// the body/query/params is never read or trusted anywhere here.
//
// A session id that does not exist, or that belongs to a different user,
// is answered identically (404, same body) -- this endpoint never reveals
// whether another user's session identifier exists.
"use strict";

const sessionService = require("../../sia/sessionService");

const NOT_FOUND_RESPONSE = {
  success: false,
  message: "Session not found.",
};

const listSessions = async (req, res) => {
  try {
    const limit = req.query && req.query.limit;
    const sessions = await sessionService.listSessions(req.userId, { limit });
    return res.status(200).json({
      success: true,
      sessions: sessions.map((s) => ({
        sessionId: String(s._id),
        title: s.title,
        messageCount: s.messageCount,
        lastMessageAt: s.lastMessageAt,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    });
  } catch (_err) {
    return res.status(503).json({ success: false, message: "SIA is temporarily unavailable." });
  }
};

const listMessages = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const limit = req.query && req.query.limit;
    const before = req.query && req.query.before ? new Date(req.query.before) : undefined;

    const result = await sessionService.listMessages(sessionId, req.userId, { limit, before });
    if (!result) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }

    return res.status(200).json({
      success: true,
      sessionId: String(result.session._id),
      messages: result.messages.map((m) => ({
        role: m.role,
        content: m.content,
        intent: m.intent,
        createdAt: m.createdAt,
      })),
    });
  } catch (_err) {
    return res.status(503).json({ success: false, message: "SIA is temporarily unavailable." });
  }
};

const deleteSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const deleted = await sessionService.deleteSession(sessionId, req.userId);
    if (!deleted) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }
    return res.status(200).json({ success: true, message: "Session deleted." });
  } catch (_err) {
    return res.status(503).json({ success: false, message: "SIA is temporarily unavailable." });
  }
};

module.exports = {
  listSessions,
  listMessages,
  deleteSession,
};
