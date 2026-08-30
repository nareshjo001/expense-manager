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
// boundary as every other SIA route (verifyToken), so an unauthenticated
// caller gets the identical 401 contract and learns nothing about the
// deployment.
//
// Deliberately NOT wrapped in siaLimiter: that limiter's strict 20/15min
// budget exists to protect the expensive, LLM-backed /ask endpoint, and
// spending it on a cheap local configuration read would mean a user who
// merely opened the SIA panel a few times could no longer ask questions.
// This route is still rate limited -- app.js mounts the whole /sia router
// behind the shared apiLimiter (150/15min, keyed on req.userId), the same
// budget every other ordinary authenticated route uses -- so separation
// required no new limiter and no change to utils/rateLimiter.js.
router.get("/status", verifyToken, status);

// Batch 2: bounded SIA conversation-session endpoints. Same
// verifyToken -> siaLimiter -> controller convention as /ask above -- no
// financial write actions are exposed here, only session/message reads and
// session deletion (deleting a conversation thread, never expense/budget/
// income/goal data).
router.get("/sessions", verifyToken, siaLimiter, listSessions);
router.get("/sessions/:sessionId/messages", verifyToken, siaLimiter, listMessages);
router.delete("/sessions/:sessionId", verifyToken, siaLimiter, deleteSession);

// Workstream 2: POST /sia/transcriptions -- voice input (speech-to-text
// only, never the answer pipeline). Same verifyToken boundary as every
// other SIA route, but its OWN dedicated rate limiter (siaVoiceLimiter --
// utils/rateLimiter.js), a SEPARATE bucket from siaLimiter above, so heavy
// audio-upload usage can never starve /ask's budget or vice versa.
// voiceReadinessGate runs before multer parses the multipart body (mirrors
// ask.js's isSiaReady() gate -- an unready deployment does no upload
// parsing). uploadAudioField (multer.memoryStorage()-backed, see
// Middlewares/audioUpload.js) runs before the controller so req.file is
// always populated (or the request already rejected with 400/413) before
// transcribe() ever inspects the bytes.
router.post(
  "/transcriptions",
  verifyToken,
  siaVoiceLimiter,
  voiceReadinessGate,
  uploadAudioField,
  transcribe
);

module.exports = router;
