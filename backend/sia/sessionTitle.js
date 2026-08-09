"use strict";

// Batch 3G: deterministic, local session-title derivation.
//
// This module deliberately does nothing clever. It is a pure, synchronous
// text transform over the first successfully answered user question -- no
// provider/LLM call, no analytics, no grounding, no conversation history,
// no logging of the question or the derived title. React's normal text
// escaping remains the only security boundary for rendering; this module
// does not attempt HTML sanitization because it never produces or consumes
// HTML -- it only normalizes whitespace/control characters in plain text.
//
// Contract (see Batch 3G Section 2):
//  - Non-string input maps to null.
//  - Control characters (tab, newline, carriage return, and other C0/C1
//    controls) are replaced with an ordinary space, then all whitespace
//    runs are collapsed to a single space and the result is trimmed.
//  - Whitespace-only / control-only input maps to null.
//  - Meaningful Unicode (Tamil script, emoji, punctuation, casing) is
//    preserved exactly, including emoji-only or punctuation-heavy text.
//  - Result is capped at MAX_TITLE_LENGTH (100) UTF-16 code units. If
//    truncation is required, a single trailing ellipsis (one codepoint) is
//    appended, and the codepoint boundary is chosen so a surrogate pair is
//    never split -- the full result (truncated text + ellipsis) never
//    exceeds MAX_TITLE_LENGTH code units.

const MAX_TITLE_LENGTH = 100;
const ELLIPSIS = String.fromCharCode(8230); // a single horizontal-ellipsis code unit

// A C0 control character is code unit 0-31, DEL is 127, and the C1 control
// range is 128-159. Checked by numeric comparison rather than a regex
// literal containing raw control bytes, so nothing unprintable lives in
// this source file. Intentionally does NOT touch printable Unicode,
// emoji, or combining marks outside these two narrow ranges.
function isControlCodeUnit(codeUnit) {
  return (codeUnit >= 0 && codeUnit <= 31) || codeUnit === 127 || (codeUnit >= 128 && codeUnit <= 159);
}

// A code unit counts as whitespace if it is an ordinary space, or if
// String.prototype.trim's own whitespace definition already treats it as
// such (this reuses the platform's Unicode whitespace table instead of
// hand-maintaining one, and correctly matches things like non-breaking
// space).
function isWhitespaceCodeUnit(codeUnit) {
  if (codeUnit === 32) {
    return true;
  }
  const ch = String.fromCharCode(codeUnit);
  return ch.trim().length === 0;
}

/**
 * Replace every control character with an ordinary space, then collapse
 * every run of whitespace (control-derived or already present) into a
 * single regular space, and trim the ends.
 */
function normalizeWhitespaceAndControls(input) {
  let normalized = "";
  for (let i = 0; i < input.length; i += 1) {
    const codeUnit = input.charCodeAt(i);
    normalized += isControlCodeUnit(codeUnit) ? " " : input[i];
  }

  let collapsed = "";
  let previousWasSpace = false;
  for (let i = 0; i < normalized.length; i += 1) {
    const codeUnit = normalized.charCodeAt(i);
    if (isWhitespaceCodeUnit(codeUnit)) {
      if (!previousWasSpace) {
        collapsed += " ";
      }
      previousWasSpace = true;
    } else {
      collapsed += normalized[i];
      previousWasSpace = false;
    }
  }

  return collapsed.trim();
}

/**
 * Truncate `text` to at most MAX_TITLE_LENGTH UTF-16 code units without
 * splitting a surrogate pair, appending a single ellipsis when truncation
 * actually occurs. `text` is assumed to already be normalized (control
 * chars removed, whitespace collapsed, trimmed).
 */
function truncateForTitle(text) {
  if (text.length <= MAX_TITLE_LENGTH) {
    return text;
  }

  // Reserve exactly one code unit for the ellipsis.
  let cut = MAX_TITLE_LENGTH - ELLIPSIS.length;

  // If the character immediately before the cut point is the high
  // surrogate of a pair (i.e. the character at `cut` is its low
  // surrogate), step back one more code unit so the pair stays intact.
  if (cut > 0) {
    const charBeforeCut = text.charCodeAt(cut - 1);
    const charAtCut = text.charCodeAt(cut);
    const isHighSurrogate = charBeforeCut >= 0xd800 && charBeforeCut <= 0xdbff;
    const isLowSurrogate = charAtCut >= 0xdc00 && charAtCut <= 0xdfff;
    if (isHighSurrogate && isLowSurrogate) {
      cut -= 1;
    }
  }

  // Trim any trailing whitespace exposed by the cut so the ellipsis
  // doesn't end up with a dangling space directly before it.
  let truncated = text.slice(0, cut);
  while (truncated.length > 0 && isWhitespaceCodeUnit(truncated.charCodeAt(truncated.length - 1))) {
    truncated = truncated.slice(0, -1);
  }

  return truncated + ELLIPSIS;
}

/**
 * Derive a deterministic, local session title from the first successfully
 * answered user question. Returns null when no meaningful title can be
 * derived (non-string input, or whitespace/control-only content).
 *
 * @param {unknown} question
 * @returns {string|null}
 */
function deriveSessionTitle(question) {
  if (typeof question !== "string") {
    return null;
  }

  const normalized = normalizeWhitespaceAndControls(question);

  if (normalized.length === 0) {
    return null;
  }

  return truncateForTitle(normalized);
}

module.exports = { deriveSessionTitle, MAX_TITLE_LENGTH };
