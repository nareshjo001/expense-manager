// Dedicated multer factory for SIA voice-input uploads (POST
"use strict";

const multer = require("multer");
const config = require("../sia/config");

function buildAudioUpload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: {
      // SIA_STT_MAX_BYTES (default 5242880) -- the size ceiling for the
      fileSize: config.sttMaxBytes,
      files: 1,
    },
  });
}

module.exports = { buildAudioUpload };
