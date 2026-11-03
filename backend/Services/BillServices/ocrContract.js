"use strict";

// The versioned OCR result contract.
const OCR_RESULT_VERSION = 1;

// A line of recognised text.
const buildLine = (text, confidence, bbox) => ({
  text,
  confidence: typeof confidence === "number" ? confidence : null,
  bbox: normalizeBbox(bbox),
});

// Tesseract reports a line box as { x0, y0, x1, y1 }.
const normalizeBbox = (bbox) => {
  if (!bbox || typeof bbox !== "object") return null;
  const { x0, y0, x1, y1 } = bbox;
  const allNumeric = [x0, y0, x1, y1].every((v) => typeof v === "number" && Number.isFinite(v));
  return allNumeric ? { x0, y0, x1, y1 } : null;
};

// Builds the canonical result.
const buildOcrResult = ({ text, confidence, lines }) => ({
  version: OCR_RESULT_VERSION,
  text: typeof text === "string" ? text : "",
  confidence: typeof confidence === "number" ? confidence : null,
  lines: Array.isArray(lines) ? lines : [],
});

// Accepts anything a caller might hand the parser and returns the canonical shape, so the parser has exactly one input form to reason about: * a canonical result -> returned as-is * an unversioned { text, confidence, lines } object (a result produced before this contract existed, or by a test fixture) -> upgraded * a bare string (the original contract) -> wrapped, no confidence data * anything else (null, undefined, a number) -> THROWS a TypeError That last case is a deliberate decision, not an oversight, and it reverses my first attempt at this function.
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
