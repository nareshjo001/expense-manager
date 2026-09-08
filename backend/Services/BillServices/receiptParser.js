// DAT-001-T03 -- the one entry point DAT-001-T02's inventory flagged as
// having no validation boundary: this used to be a bare
// parseFloat(rawText), which silently returns NaN (or a wrong prefix
// value, e.g. "12.34.56" -> 12.34) for a malformed OCR match. Routed
// through the shared parseAmountInput() so a bad match fails closed
// (null, "couldn't extract an amount") instead of quietly writing NaN
// or a bogus value into expenseAmount.
const { parseAmountInput } = require("../../utils/money");

// OCR-002: parseReceipt used to only ever see a single flattened string,
// with every newline already collapsed into a space by ocrService.js.
// ocrService.js now preserves layout and also hands back an overall
// confidence score and a per-line { text, confidence } breakdown, as
// { text, confidence, lines }. This module accepts either shape --
// a bare string (the legacy contract, and what a caller with no
// confidence data can still pass) or that object -- and normalizes to
// one internal shape. Anything else (null, undefined, a number, a
// malformed object) is passed through as-is: the extractors below then
// fail exactly the way they always have (a TypeError out of
// extractMerchant's text.trim()), not a new, silently different failure
// mode.
const normalizeOcrInput = (input) => {
  if (typeof input === "string") {
    return { text: input, confidence: null, lines: null };
  }
  if (input && typeof input === "object" && typeof input.text === "string") {
    return {
      text: input.text,
      confidence: typeof input.confidence === "number" ? input.confidence : null,
      lines: Array.isArray(input.lines) ? input.lines : null,
    };
  }
  return { text: input, confidence: null, lines: null };
};

// Approximate the merchant name from the first words of the receipt.
const extractMerchant = (text) => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).join(" ");
};

// Extract the receipt total amount, along with the matched text so its
// confidence can be looked up against the OCR's per-line breakdown.
const extractAmount = (text) => {
  const matches = [
    ...text.matchAll(
      /(grand total|total)[^\d]*([\d,.]+)/gi
    ),
  ];

  if (!matches.length) {
    return { value: null, matchedText: null };
  }

  // Prefer grand total, else use the last match.
  const grandTotal = matches.find(match =>
    match[1].toLowerCase().includes("grand")
  );

  const finalMatch =
    grandTotal || matches[matches.length - 1];

  return { value: parseAmountInput(finalMatch[2]), matchedText: finalMatch[0] };
};

// Extract the receipt date in any supported format, along with the
// matched text so its confidence can be looked up against the OCR's
// per-line breakdown.
const extractDate = (text) => {
  const dateRegex =
    /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})|(\d{1,2}(st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4})/i;

  const match = text.match(dateRegex);

  if (!match) {
    return { value: null, matchedText: null };
  }

  return { value: match[0], matchedText: match[0] };
};

// Extract the line-item section of the receipt.
const extractItemsBlock = (text) => {
  let itemSection = text;

  const itemStart =
    text.search(/item/i);

  if (itemStart !== -1) {
    itemSection =
      text.substring(itemStart);
  }

  // Cut off at the totals or payment section.
  const stopRegex =
    /(subtotal|gst|grand total|total|payment|thank you)/i;

  const stopMatch =
    itemSection.match(stopRegex);

  if (stopMatch) {
    itemSection =
      itemSection.substring(
        0,
        stopMatch.index
      );
  }

  return itemSection.trim();
};

// OCR-002: look up the OCR confidence of whatever text a field was
// extracted from, by finding the OCR line it came from. Returns null
// (not a guess, not 0) whenever there's nothing to look it up against --
// no lines available (legacy string input, or blocks weren't returned),
// or the field itself found no match.
const findFieldConfidence = (lines, matchedText) => {
  if (!Array.isArray(lines) || !lines.length || !matchedText) {
    return null;
  }

  const needle = String(matchedText).trim().toLowerCase();
  if (!needle) {
    return null;
  }

  for (const line of lines) {
    if (line && typeof line.text === "string" && line.text.toLowerCase().includes(needle)) {
      return typeof line.confidence === "number" ? line.confidence : null;
    }
  }

  return null;
};

// Extract the expense fields the client needs from raw OCR output.
// Accepts either a bare OCR string or ocrService.js's
// { text, confidence, lines } result.
const parseReceipt = (input) => {
  const { text, confidence: overallConfidence, lines } = normalizeOcrInput(input);

  const expenseName = extractMerchant(text);
  const amount = extractAmount(text);
  const date = extractDate(text);

  const fieldConfidence = {
    expenseName: findFieldConfidence(lines, expenseName),
    expenseAmount: findFieldConfidence(lines, amount.matchedText),
    expenseDate: findFieldConfidence(lines, date.matchedText),
  };

  // Best-effort review flag: no amount was found at all, or (when OCR
  // gave us an overall confidence score) that score is low. Never
  // treated as an error by itself -- upload still succeeds -- just
  // surfaced so a caller can prompt the user to double-check the parse.
  const needsReview =
    amount.value === null ||
    (typeof overallConfidence === "number" && overallConfidence < 60);

  return {
    expenseName,
    expenseAmount: amount.value,
    expenseDate: date.value,
    overallConfidence,
    fieldConfidence,
    needsReview,
  };
};

module.exports = {
  parseReceipt,
};
