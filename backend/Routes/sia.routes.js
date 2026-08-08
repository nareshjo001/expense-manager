const router = require("express").Router();

const { ask } = require("../Controllers/SiaControllers/ask");
const {
  listSessions,
  listMessages,
  deleteSession,
} = require("../Controllers/SiaControllers/sessions");
const verifyToken = require("../Middlewares/Auth");
const { siaLimiter } = require("../utils/rateLimiter");

// M3-1: verifyToken first (so req.userId is always set before the limiter
// keys on it), then the dedicated SIA limiter, then the controller.
router.post("/ask", verifyToken, siaLimiter, ask);

// Batch 2: bounded SIA conversation-session endpoints. Same
// verifyToken -> siaLimiter -> controller convention as /ask above -- no
// financial write actions are exposed here, only session/message reads and
// session deletion (deleting a conversation thread, never expense/budget/
// income/goal data).
router.get("/sessions", verifyToken, siaLimiter, listSessions);
router.get("/sessions/:sessionId/messages", verifyToken, siaLimiter, listMessages);
router.delete("/sessions/:sessionId", verifyToken, siaLimiter, deleteSession);

module.exports = router;
