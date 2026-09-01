// Container-signature (magic-byte) detection for SIA voice-input uploads
"use strict";

// Stable container-type keys -- also used by Controllers/SiaControllers/status.js
const MIME_TYPE_BY_CONTAINER = Object.freeze({
  webm: "audio/webm",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp4: "audio/mp4",
});

// True only when `buffer` has enough bytes and every byte in `expectedBytes`
function matchesBytes(buffer, offset, expectedBytes) {
  if (offset < 0 || buffer.length < offset + expectedBytes.length) {
    return false;
  }
  for (let i = 0; i < expectedBytes.length; i += 1) {
    if (buffer[offset + i] !== expectedBytes[i]) {
      return false;
    }
  }
  return true;
}

// Detects the real container family of `buffer` from its magic bytes only.
function detectContainerType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return null;
  }

  // WebM/Matroska -- EBML header: 0x1A 0x45 0xDF 0xA3. Covers both WebM
  if (matchesBytes(buffer, 0, [0x1a, 0x45, 0xdf, 0xa3])) {
    return "webm";
  }

  // Ogg (Ogg/Opus, Ogg/Vorbis) -- capture pattern "OggS".
  if (matchesBytes(buffer, 0, [0x4f, 0x67, 0x67, 0x53])) {
    return "ogg";
  }

  // WAV -- RIFF container with a WAVE form type: "RIFF" at offset 0,
  if (matchesBytes(buffer, 0, [0x52, 0x49, 0x46, 0x46]) && matchesBytes(buffer, 8, [0x57, 0x41, 0x56, 0x45])) {
    return "wav";
  }

  // MP4/M4A -- ISO base media file format box: a 4-byte big-endian box
  if (matchesBytes(buffer, 4, [0x66, 0x74, 0x79, 0x70])) {
    return "mp4";
  }

  return null;
}

// Maps a detected container type to its canonical MIME string, or null for
// an unrecognized/unsupported container key.
function mimeTypeForContainer(containerType) {
  return Object.prototype.hasOwnProperty.call(MIME_TYPE_BY_CONTAINER, containerType)
    ? MIME_TYPE_BY_CONTAINER[containerType]
    : null;
}

module.exports = {
  detectContainerType,
  mimeTypeForContainer,
  MIME_TYPE_BY_CONTAINER,
};
