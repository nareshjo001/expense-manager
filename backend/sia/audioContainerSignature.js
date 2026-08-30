// Container-signature (magic-byte) detection for SIA voice-input uploads
// (POST /sia/transcriptions). Deliberately does NOT trust the client-
// supplied Content-Type/MIME header or filename extension -- those are
// attacker-controlled and never inspected anywhere in this module. The
// ONLY signal used is the actual leading bytes of the uploaded buffer,
// checked against the fixed container signatures below.
//
// No `file-type` (or similar) npm dependency is installed in this repo
// (backend/package.json has no such entry, and none is vendored in
// node_modules) -- this hand-rolled check is deliberately narrow: exactly
// the four container families POST /sia/transcriptions accepts
// (WebM/Opus, Ogg/Opus, WAV, MP4/M4A), not a general-purpose file-type
// sniffer.
"use strict";

// Stable container-type keys -- also used by Controllers/SiaControllers/status.js
// to build the client-facing acceptedMimeTypes list, so the two can never
// silently drift apart.
const MIME_TYPE_BY_CONTAINER = Object.freeze({
  webm: "audio/webm",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp4: "audio/mp4",
});

// True only when `buffer` has enough bytes and every byte in `expectedBytes`
// matches, starting at `offset`. Never throws for a short/undersized buffer
// -- simply returns false.
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
// Returns one of "webm" | "ogg" | "wav" | "mp4", or null when the buffer is
// missing, not a Buffer, too short to contain any recognized signature, or
// simply does not match one of the four accepted signatures (including a
// text file, an empty buffer, or a MIME-header lie with mismatched real
// bytes).
function detectContainerType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    return null;
  }

  // WebM/Matroska -- EBML header: 0x1A 0x45 0xDF 0xA3. Covers both WebM
  // audio (audio/webm, typically Opus) and, structurally, any other
  // EBML/Matroska container -- POST /sia/transcriptions only advertises
  // audio/webm for this signature.
  if (matchesBytes(buffer, 0, [0x1a, 0x45, 0xdf, 0xa3])) {
    return "webm";
  }

  // Ogg (Ogg/Opus, Ogg/Vorbis) -- capture pattern "OggS".
  if (matchesBytes(buffer, 0, [0x4f, 0x67, 0x67, 0x53])) {
    return "ogg";
  }

  // WAV -- RIFF container with a WAVE form type: "RIFF" at offset 0,
  // "WAVE" at offset 8 (offset 4-7 is the RIFF chunk size, which varies
  // per file and is deliberately not checked).
  if (matchesBytes(buffer, 0, [0x52, 0x49, 0x46, 0x46]) && matchesBytes(buffer, 8, [0x57, 0x41, 0x56, 0x45])) {
    return "wav";
  }

  // MP4/M4A -- ISO base media file format box: a 4-byte big-endian box
  // size (which varies per file and is deliberately not checked) followed
  // by the "ftyp" box type at offset 4.
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
