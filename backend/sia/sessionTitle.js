"use strict";

// Deterministic, local session-title derivation: a pure, synchronous text transform over the first answered question -- no provider/LLM call, no logging of the question or title. React's normal text escaping is the only rendering security boundary (this module never produces/consumes HTML). Contract: non-string or whitespace/control-only input maps to null; control characters become spaces, whitespace collapses and trims; meaningful Unicode is preserved exactly; result is capped at MAX_TITLE_LENGTH (100) UTF-16 code units with a trailing ellipsis on truncation, never splitting a surrogate pair.

const MAX_TITLE_LENGTH = 100;
const ELLIPSIS = String.fromCharCode(8230); // a single horizontal-ellipsis code unit

// C0 control is code unit 0-31, DEL is 127, C1 control is 128-159 -- checked by numeric comparison (not a regex with raw control bytes) so nothing unprintable lives in this source file; printable Unicode/emoji outside these ranges is untouched.
function isControlCodeUnit(codeUnit) {
  return (codeUnit >= 0 && codeUnit <= 31) || codeUnit === 127 || (codeUnit >= 128 && codeUnit <= 159);
}

// Ordinary space, or anything String.prototype.trim's own whitespace definition already treats as such -- reuses the platform's Unicode whitespace table instead of hand-maintaining one.
function isWhitespaceCodeUnit(codeUnit) {
  if (codeUnit === 32) {
    return true;
  }
  const ch = String.fromCharCode(codeUnit);
  return ch.trim().length === 0;
}

// Replaces every control character with a space, collapses whitespace runs to a single space, and trims the ends.
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

// Truncates `text` (assumed already normalized) to at most MAX_TITLE_LENGTH UTF-16 code units without splitting a surrogate pair, appending an ellipsis when truncation occurs.
function truncateForTitle(text) {
  if (text.length <= MAX_TITLE_LENGTH) {
    return text;
  }

  // Reserve exactly one code unit for the ellipsis.
  let cut = MAX_TITLE_LENGTH - ELLIPSIS.length;

  // If the cut point falls inside a surrogate pair, step back one more code unit so the pair stays intact.
  if (cut > 0) {
    const charBeforeCut = text.charCodeAt(cut - 1);
    const charAtCut = text.charCodeAt(cut);
    const isHighSurrogate = charBeforeCut >= 0xd800 && charBeforeCut <= 0xdbff;
    const isLowSurrogate = charAtCut >= 0xdc00 && charAtCut <= 0xdfff;
    if (isHighSurrogate && isLowSurrogate) {
      cut -= 1;
    }
  }

  // Trim trailing whitespace exposed by the cut so the ellipsis doesn't end up with a dangling space before it.
  let truncated = text.slice(0, cut);
  while (truncated.length > 0 && isWhitespaceCodeUnit(truncated.charCodeAt(truncated.length - 1))) {
    truncated = truncated.slice(0, -1);
  }

  return truncated + ELLIPSIS;
}

/* Derive a deterministic, local session title from the first successfully */
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
