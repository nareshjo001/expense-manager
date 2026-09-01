const router = require("express").Router();

const { ask } = require("../Controllers/SiaControllers/ask");
const { status } = require("../Controllers/SiaControllers/status");
const {
  listSessions,
  listMessages,
  deleteSession,
} = require("../Controllers/SiaControllers/sessions");
const {
  transcribe,
  uploadAudioField,
  voiceReadinessGate,
} = require("../Controllers/SiaControllers/transcribe");
const verifyToken = require("../Middlewares/Auth");
const { siaLimiter, siaVoiceLimiter } = require("../utils/rateLimiter");

// M3-1: verifyToken first (so req.userId is always set before the limiter
// keys on it), then the dedicated SIA limiter, then the controller.
router.post("/ask", verifyToken, siaLimiter, ask);

// Batch 3E: runtime availability check. Uses the SAME authentication
router.get("/status", verifyToken, status);

// Batch 2: bounded SIA conversation-session endpoints. Same
router.get("/sessions", verifyToken, siaLimiter, listSessions);
router.get("/sessions/:sessionId/messages", verifyToken, siaLimiter, listMessages);
router.delete("/sessions/:sessionId", verifyToken, siaLimiter, deleteSession);

// Workstream 2: POST /sia/transcriptions -- voice input (speech-to-text
router.post(
  "/transcriptions",
  verifyToken,
  siaVoiceLimiter,
  voiceReadinessGate,
  uploadAudioField,
  transcribe
);

module.exports = router;
