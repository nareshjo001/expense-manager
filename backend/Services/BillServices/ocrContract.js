"use strict";

// OCR-003-T01 -- the versioned OCR result contract.
//
// Before this, ocrService.js and receiptParser.js agreed on a shape by
// convention only: ocrService returned { text, confidence, lines } and
// receiptParser accepted "either a bare string or that object", inferring
// which by duck-typing. That worked, but it meant the two modules could
// drift silently -- add a field on one side and nothing tells you the other
// side ignores it, and a consumer had no way to ask "which shape is this?"
// other than inspecting it.
//
// This module makes the shape explicit and stamps it with a version, so:
//   * a stored or forwarded OCR result can be identified later, even after
//     the shape changes again;
//   * a consumer can branch on the version rather than on the presence of a
//     field, which is what makes an additive change safe;
//   * the legacy string form stays supported, but is CONVERTED at a single
//     known boundary instead of being special-cased in the parser.
//
// Versioning rule: bump OCR_RESULT_VERSION only when an existing field
// changes meaning or disappears. ADDING a field does not need a bump --
// consumers that ignore it keep working, which is the whole point of
// keeping the result additive. T02 added `bbox` to each line under version
// 1 for exactly that reason.
const OCR_RESULT_VERSION = 1;

// A line of recognised text.
//   text       -- normalised line content, never empty
//   confidence -- Tesseract's 0-100 score for the line, or null when the
//                 engine did not return the block hierarchy. NEVER a
//                 substituted 0: "unknown" and "certainly wrong" have to
//                 stay distinguishable, since a caller may reasonably treat
//                 low confidence as a reason to prompt the user and must not
//                 do that merely because detail was unavailable.
//   bbox       -- { x0, y0, x1, y1 } pixel box, or null. See T02.
const buildLine = (text, confidence, bbox) => ({
  text,
  confidence: typeof confidence === "number" ? confidence : null,
  bbox: normalizeBbox(bbox),
});

// Tesseract reports a line box as { x0, y0, x1, y1 }. Anything missing a
// numeric coordinate is reduced to null rather than partially populated: a
// half-known box invites a consumer to draw or crop with an undefined edge,
// and silently produces a wrong region instead of an obvious absence.
const normalizeBbox = (bbox) => {
  if (!bbox || typeof bbox !== "object") return null;
  const { x0, y0, x1, y1 } = bbox;
  const allNumeric = [x0, y0, x1, y1].every((v) => typeof v === "number" && Number.isFinite(v));
  return allNumeric ? { x0, y0, x1, y1 } : null;
};

// Builds the canonical result. Callers should not assemble the object by
// hand -- going through here is what guarantees the version stamp and the
// null-vs-missing discipline above.
const buildOcrResult = ({ text, confidence, lines }) => ({
  version: OCR_RESULT_VERSION,
  text: typeof text === "string" ? text : "",
  confidence: typeof confidence === "number" ? confidence : null,
  lines: Array.isArray(lines) ? lines : [],
});

// Accepts anything a caller might hand the parser and returns the canonical
// shape, so the parser has exactly one input form to reason about:
//   * a canonical result -> returned as-is
//   * an unversioned { text, confidence, lines } object (a result produced
//     before this contract existed, or by a test fixture) -> upgraded
//   * a bare string (the original contract) -> wrapped, no confidence data
//   * anything else (null, undefined, a number) -> THROWS a TypeError
//
// That last case is a deliberate decision, not an oversight, and it reverses
// my first attempt at this function. receiptParser.hostileText.test.js
// documented the pre-existing throw and explicitly left the choice to
// "whoever owns receiptParser.js next"; taking that decision, the throw is
// correct and should stay.
//
// The reasoning: extractTextFromImage() always returns a string, so the real
// upload -> OCR -> parse path CANNOT produce a non-string here. A null
// therefore means a caller bug, not a bad receipt. Degrading it to an empty
// result would report "no amount found, please review" -- indistinguishable
// from a genuinely blank receipt -- so the bug would surface as a user being
// asked to check a receipt that scanned fine, and could end with a
// no-amount expense written from a code path that never ran correctly.
// Failing loudly sends it to the error reporter instead, where a bug
// belongs.
//
// What DOES change is the message. Previously this surfaced as a TypeError
// from extractMerchant's text.trim(), which names the wrong culprit; the
// error now says what was actually wrong and where the boundary is.
const toOcrResult = (input) => {
  if (input && typeof input === "object" && input.version === OCR_RESULT_VERSION) {
    return { result: input };
  }

  if (typeof input === "string") {
    return { result: buildOcrResult({ text: input, confidence: null, lines: [] }) };
  }

  if (input && typeof input === "object" && typeof input.text === "string") {
    return {
      result: buildOcrResult({
        text: input.text,
        confidence: input.confidence,
        lines: Array.isArray(input.lines)
          ? input.lines.map((l) => buildLine(l?.text, l?.confidence, l?.bbox))
          : [],
      }),
    };
  }

  throw new TypeError(
    `toOcrResult: expected an OCR result object or a string, got ${input === null ? "null" : typeof input}`
  );
};

module.exports = {
  OCR_RESULT_VERSION,
  buildLine,
  buildOcrResult,
  toOcrResult,
  normalizeBbox,
};
