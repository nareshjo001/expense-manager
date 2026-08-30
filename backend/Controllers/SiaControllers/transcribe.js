// SIA voice-input controller (Workstream 2) -- POST /sia/transcriptions,
// the sole voice-input endpoint. Strictly a speech-to-text boundary: it
// NEVER accepts a `question` field, NEVER creates/touches a SIA
// conversation session (no import of sia/sessionService.js), NEVER calls
// askLlm/the answer pipeline (no import of sia/llmService.js), and NEVER
// calls the ml-service HTTP route or client (no import of the ML service
// client helper or its router). Its only job is: accept one audio file,
// verify its REAL container signature (never the client-supplied MIME
// header), hand it to sia/transcriptionService.js, and return the
// transcript.
//
// Privacy: no audio bytes, transcript text, or Authorization header value
// is ever passed to logSiaEvent() (sia/safeLogger.js) -- only the same
// four safe fields ask.js already logs (event name, provider, errorCode,
// latencyMs). req.file.buffer is read exactly once, synchronously, to
// build the provider request; nothing here retains a reference to it
// afterward (no module-level variable, cache, or session), and
// multer.memoryStorage() (Middlewares/audioUpload.js) guarantees it was
// never written to disk in the first place.
"use strict";

const multer = require("multer");

const { buildAudioUpload } = require("../../Middlewares/audioUpload");
const config = require("../../sia/config");
const { isVoiceReady } = require("../../sia/readiness");
const { detectContainerType, mimeTypeForContainer } = require("../../sia/audioContainerSignature");
const { transcribeAudio } = require("../../sia/transcriptionService");
const { logSiaEvent, SIA_LOG_EVENTS } = require("../../sia/safeLogger");

// Deliberately the same generic body shape ask.js's UNAVAILABLE_RESPONSE
// uses -- never exposes TranscriptionProviderError details, stack traces,
// provider names, audio bytes, or transcript text.
const UNAVAILABLE_RESPONSE = {
  success: false,
  message: "SIA voice input is temporarily unavailable.",
};

// languageHint is an optional BCP-47-ish hint (e.g. "en", "en-US", "hi") --
// bounded length, letters/hyphen only. Anything else is rejected as a 400
// before any file/provider work happens.
const MAX_LANGUAGE_HINT_LENGTH = 10;
const LANGUAGE_HINT_PATTERN = /^[a-zA-Z-]+$/;

function isValidLanguageHint(value) {
  if (value === undefined || value === null) return true;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_LANGUAGE_HINT_LENGTH) return false;
  return LANGUAGE_HINT_PATTERN.test(trimmed);
}

// Readiness gate, run BEFORE multer parses the multipart body -- mirrors
// ask.js's isSiaReady() gate: an unready deployment does no upload
// parsing, no signature check, and no provider work, and leaves no trace.
// isVoiceReady() (sia/readiness.js) is the SAME function GET /sia/status
// answers capabilities.voiceInput.available with, so the two can never
// disagree.
function voiceReadinessGate(req, res, next) {
  if (!isVoiceReady()) {
    return res.status(503).json(UNAVAILABLE_RESPONSE);
  }
  return next();
}

// Multer's own errors (size limit, unexpected field name, etc.) surface
// via this callback -- mapped to the documented public status codes here,
// following the SAME wrapper convention Routes/bill.routes.js already
// established (upload.single(field)(req, res, cb)) for the sibling
// disk-storage upload, just with an added 413 branch for the size limit.
// The client-supplied filename is never read here or anywhere downstream
// -- multer's `single()` only ever populates req.file from the actual
// multipart stream, and the container-signature check below never
// consults req.file.originalname or req.file.mimetype either.
function uploadAudioField(req, res, next) {
  // Built fresh per request so a change to config.sttMaxBytes always takes
  // effect immediately (see Middlewares/audioUpload.js's factory
  // rationale) -- never a single instance whose fileSize limit was baked
  // in once at process/module-require time.
  const audioUpload = buildAudioUpload();
  audioUpload.single("audio")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          success: false,
          message: "Audio file exceeds the maximum allowed size.",
        });
      }
      // LIMIT_UNEXPECTED_FILE (wrong field name), LIMIT_FILE_COUNT, etc. --
      // all treated as a malformed request, never a provider/server detail.
      return res.status(400).json({
        success: false,
        message: "audio file field is missing or invalid.",
      });
    }
    if (err) {
      return res.status(400).json({
        success: false,
        message: "audio file field is missing or invalid.",
      });
    }
    return next();
  });
}

// Maps a TranscriptionProviderError's normalized `.code` to the documented
// public status code. Every branch other than the explicit 422 case below
// resolves to the SAME generic 503 body ask.js's LlmProviderError handling
// uses for its own provider failures -- no code is ever echoed back to the
// client.
function isEmptyOutputError(err) {
  return Boolean(err) && err.code === "PROVIDER_EMPTY_OUTPUT";
}

// Writes the response defensively: if the client already disconnected
// (the same "close" event that triggered the abort above), the socket may
// no longer be writable. Swallowing that failure here is what keeps a
// mid-request abort from ever crashing the process or surfacing as an
// unhandled rejection -- there is no client left to receive this response
// either way.
function safeRespond(res, statusCode, body) {
  try {
    if (res.headersSent) return;
    res.status(statusCode).json(body);
  } catch (_err) {
    // Best-effort only -- see comment above.
  }
}

const transcribe = async (req, res) => {
  if (!req.file || !Buffer.isBuffer(req.file.buffer) || req.file.buffer.length === 0) {
    return res.status(400).json({ success: false, message: "An audio file is required." });
  }

  const { languageHint, durationHintSeconds } = req.body || {};

  if (!isValidLanguageHint(languageHint)) {
    return res.status(400).json({ success: false, message: "languageHint is invalid." });
  }

  if (durationHintSeconds !== undefined && durationHintSeconds !== null && durationHintSeconds !== "") {
    const parsedDurationHint = Number(durationHintSeconds);
    if (!Number.isFinite(parsedDurationHint) || parsedDurationHint < 0) {
      return res.status(400).json({ success: false, message: "durationHintSeconds is invalid." });
    }
    if (parsedDurationHint > config.sttMaxDurationSeconds) {
      return res.status(422).json({
        success: false,
        message: "Audio duration exceeds the maximum allowed length.",
      });
    }
  }

  // Real container-signature check on the ACTUAL uploaded bytes -- the
  // client-supplied Content-Type/mimetype header is never consulted here
  // or anywhere else in this file.
  const containerType = detectContainerType(req.file.buffer);
  if (!containerType) {
    return res.status(415).json({
      success: false,
      message: "Unsupported or unrecognized audio format.",
    });
  }
  const mimeType = mimeTypeForContainer(containerType);

  // Abort wiring: a genuine mid-request client disconnect should cancel the
  // in-flight provider call rather than letting it run to completion for no
  // one. IMPORTANT: Node's `req` (http.IncomingMessage) 'close' event fires
  // once the request body has been FULLY READ -- which happens on every
  // normal request, shortly after multer finishes parsing the multipart
  // body, regardless of whether the client is still connected or a
  // response has been produced yet. Treating that event alone as proof of
  // disconnection (a previous version of this handler did) aborts the
  // provider call within milliseconds of every request, long before a real
  // Groq round trip could ever complete -- observed as
  // PROVIDER_REQUEST_ABORTED at ~5-16ms latency.
  //
  // The two signals actually trustworthy here:
  //   1. `req`'s 'aborted' event -- fires only for a genuine
  //      connection-level abort of the request.
  //   2. `res`'s 'close' event, but ONLY when `res.writableEnded` is still
  //      false at that moment -- the underlying connection died before this
  //      handler finished sending its response. `res.writableEnded`
  //      becomes true synchronously once safeRespond()'s res.json() call
  //      below runs, so a 'close' that fires afterward (the ordinary case
  //      for a completed request) is correctly ignored, never a false
  //      abort.
  // Both listeners are guarded by `responded` so neither can fire (or
  // touch `res`) after a response has already been produced, and both are
  // always removed in `finally` once this request settles, whichever way.
  const abortController = new AbortController();
  let responded = false;
  function onRequestAborted() {
    if (!responded) {
      abortController.abort();
    }
  }
  function onResponseClose() {
    if (!responded && res.writableEnded === false) {
      abortController.abort();
    }
  }
  req.on("aborted", onRequestAborted);
  res.on("close", onResponseClose);

  const startedAt = Date.now();
  try {
    const result = await transcribeAudio({
      buffer: req.file.buffer,
      // Server-owned filename only -- req.file.originalname (client
      // supplied) is never read or forwarded anywhere.
      filename: "audio",
      mimeType,
      languageHint: typeof languageHint === "string" ? languageHint.trim() : undefined,
      signal: abortController.signal,
    });

    logSiaEvent({
      event: SIA_LOG_EVENTS.PROVIDER_REQUEST_COMPLETED,
      provider: config.sttProvider,
      latencyMs: Date.now() - startedAt,
    });

    return safeRespond(res, 200, {
      success: true,
      transcript: result.transcript,
      detectedLanguage: result.detectedLanguage,
      durationMs: result.durationMs,
    });
  } catch (err) {
    logSiaEvent({
      event: SIA_LOG_EVENTS.PROVIDER_REQUEST_FAILED,
      provider: config.sttProvider,
      errorCode: err && err.code,
      latencyMs: Date.now() - startedAt,
    });

    if (isEmptyOutputError(err)) {
      return safeRespond(res, 422, {
        success: false,
        message: "The audio could not be processed (no speech detected).",
      });
    }

    return safeRespond(res, 503, UNAVAILABLE_RESPONSE);
  } finally {
    responded = true;
    req.removeListener("aborted", onRequestAborted);
    res.removeListener("close", onResponseClose);
  }
};

module.exports = {
  transcribe,
  uploadAudioField,
  voiceReadinessGate,
};
