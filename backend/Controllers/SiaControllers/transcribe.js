// SIA voice-input controller (Workstream 2) -- POST /sia/transcriptions,
"use strict";

const multer = require("multer");

const { buildAudioUpload } = require("../../Middlewares/audioUpload");
const config = require("../../sia/config");
const { isVoiceReady } = require("../../sia/readiness");
const { detectContainerType, mimeTypeForContainer } = require("../../sia/audioContainerSignature");
const { transcribeAudio } = require("../../sia/transcriptionService");
const { logSiaEvent, SIA_LOG_EVENTS } = require("../../sia/safeLogger");

// Deliberately the same generic body shape ask.js's UNAVAILABLE_RESPONSE
const UNAVAILABLE_RESPONSE = {
  success: false,
  message: "SIA voice input is temporarily unavailable.",
};

// languageHint is an optional BCP-47-ish hint (e.g. "en", "en-US", "hi") --
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
function voiceReadinessGate(req, res, next) {
  if (!isVoiceReady()) {
    return res.status(503).json(UNAVAILABLE_RESPONSE);
  }
  return next();
}

// Multer's own errors (size limit, unexpected field name, etc.) surface
function uploadAudioField(req, res, next) {
  // Built fresh per request so a change to config.sttMaxBytes always takes
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
function isEmptyOutputError(err) {
  return Boolean(err) && err.code === "PROVIDER_EMPTY_OUTPUT";
}

// Writes the response defensively: if the client already disconnected
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
  const containerType = detectContainerType(req.file.buffer);
  if (!containerType) {
    return res.status(415).json({
      success: false,
      message: "Unsupported or unrecognized audio format.",
    });
  }
  const mimeType = mimeTypeForContainer(containerType);

  // Abort wiring: a genuine mid-request client disconnect should cancel the
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
