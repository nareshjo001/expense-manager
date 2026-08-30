// Dedicated multer factory for SIA voice-input uploads (POST
// /sia/transcriptions), Workstream 2. Deliberately separate from
// Middlewares/upload.js's disk-storage bill-upload instance (which this
// module does not import, modify, or reuse) -- audio bytes must NEVER be
// written to disk, so this uses multer.memoryStorage() exclusively.
//
// Exports a FACTORY (buildAudioUpload()), not a single pre-built multer
// instance, so config.sttMaxBytes is read fresh on every call rather than
// baked in once at module-require time -- the same "read config at
// call/request time, never cache it into a closure at require time"
// convention sia/llmService.js already follows for config.model/
// config.timeoutMs. multer's own fileSize option is a static per-instance
// number (it can't be a dynamic function), so honoring a fresh
// config.sttMaxBytes value on every request means constructing a fresh
// (cheap) multer instance per request rather than reusing one singleton.
//
// req.file.buffer is used exactly once per request, synchronously, by
// Controllers/SiaControllers/transcribe.js; nothing in this module (or the
// controller) retains a reference to it beyond that request/response
// cycle -- no module-level variable, cache, or session.
"use strict";

const multer = require("multer");
const config = require("../sia/config");

function buildAudioUpload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      // SIA_STT_MAX_BYTES (default 5242880) -- the size ceiling for the
      // "audio" field; multer/busboy enforces this (LIMIT_FILE_SIZE) before
      // any container-signature check or provider call ever runs. NOTE
      // (found by Workstream 5's adversarial review): busboy's fileSize
      // check in this multer version rejects a file of EXACTLY
      // config.sttMaxBytes bytes with the same LIMIT_FILE_SIZE/413 error as
      // a larger one -- the true usable maximum is config.sttMaxBytes - 1
      // byte, one stricter than the documented ceiling. This is a
      // fail-closed direction (rejects slightly more than advertised,
      // never accepts more), so it was left as-is rather than loosened;
      // documented here so SIA_STT_MAX_BYTES/status.js's advertised
      // maxBytes value is understood as an inclusive-looking but
      // effectively exclusive ceiling.
      fileSize: config.sttMaxBytes,
      files: 1,
    },
  });
}

module.exports = { buildAudioUpload };
