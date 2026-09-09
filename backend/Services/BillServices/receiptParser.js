// DAT-001-T03 -- the one entry point DAT-001-T02's inventory flagged as
// having no validation boundary: this used to be a bare parseFloat(rawText),
// which silently returns NaN (or a wrong prefix value, e.g. "12.34.56" ->
// 12.34) for a malformed OCR match. Amount parsing now goes through the
// shared parseAmountInput() inside receiptExtractors.js, so a bad match
// fails closed (null) instead of quietly writing NaN into expenseAmount.
//
// OCR-003-T01/T03/T04 -- this module used to own three responsibilities:
// deciding what shape of OCR input it had been handed, extracting each
// field, and judging whether the result was trustworthy. They are now
// separated: ocrContract.js owns the shape, receiptExtractors.js owns the
// field logic (and is independently testable), and this file composes them
// and produces the review verdict.
"use strict";

const { toOcrResult } = require("./ocrContract");
const {
  extractMerchant,
  extractAmount,
  extractDate,
  looksLikeHeading,
} = require("./receiptExtractors");

// Below this, a field is worth a second look. Tesseract's per-line score is
// 0-100 and degrades gracefully, so this is a judgement call rather than a
// derived constant: 60 is low enough that clean receipts do not trip it and
// high enough to catch the smudged-thermal-print case that produces
// plausible-looking wrong digits -- the failure that actually costs a user
// money, because a wrong amount still looks like an amount.
const LOW_CONFIDENCE_THRESHOLD = 60;

// OCR-003-T04 -- machine-readable reasons, not just a boolean.
//
// `needsReview` alone tells a UI to show a warning but not what to say, so
// every consumer either says something vague ("please check this receipt")
// or re-derives the reason from the raw fields, duplicating this logic.
// These codes let the caller point at the specific field and explain the
// specific doubt. They are codes rather than sentences so the wording stays
// the UI's decision and can be translated.
const REVIEW_REASONS = {
  NO_AMOUNT_FOUND: "NO_AMOUNT_FOUND",
  AMBIGUOUS_AMOUNT: "AMBIGUOUS_AMOUNT",
  NO_DATE_FOUND: "NO_DATE_FOUND",
  LOW_OVERALL_CONFIDENCE: "LOW_OVERALL_CONFIDENCE",
  LOW_AMOUNT_CONFIDENCE: "LOW_AMOUNT_CONFIDENCE",
  LOW_DATE_CONFIDENCE: "LOW_DATE_CONFIDENCE",
  MERCHANT_LOOKS_LIKE_HEADING: "MERCHANT_LOOKS_LIKE_HEADING",
  NO_TEXT_RECOGNISED: "NO_TEXT_RECOGNISED",
};

// Look up the OCR confidence of whatever text a field was extracted from, by
// finding the OCR line it came from. Returns null -- not a guess, not 0 --
// whenever there is nothing to look it up against: no lines available
// (legacy string input, or blocks weren't returned), or the field found no
// match. That distinction matters downstream: "unknown confidence" must not
// trigger a low-confidence warning, or every legacy caller would see one on
// every receipt and learn to ignore it.
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

// Only a NUMBER below the threshold counts as low. null means unknown and is
// deliberately not treated as low, for the reason above.
const isLow = (confidence) =>
  typeof confidence === "number" && confidence < LOW_CONFIDENCE_THRESHOLD;

// Extract the expense fields the client needs from OCR output. Accepts a
// versioned OCR result, a legacy { text, confidence, lines } object, or a
// bare string; ocrContract.toOcrResult() normalises all three.
const parseReceipt = (input) => {
  // Throws a TypeError on input that is not a string or an OCR result --
  // see ocrContract.toOcrResult() for why that stays a throw.
  const { result } = toOcrResult(input);
  const { text, confidence: overallConfidence, lines } = result;

  const expenseName = extractMerchant(text);
  const amount = extractAmount(text);
  const date = extractDate(text);

  const fieldConfidence = {
    expenseName: findFieldConfidence(lines, expenseName),
    expenseAmount: findFieldConfidence(lines, amount.matchedText),
    expenseDate: findFieldConfidence(lines, date.matchedText),
  };

  const reviewReasons = [];

  // Ordered most to least consequential, so a UI that shows only the first
  // reason still shows the one that matters most. A wrong or missing amount
  // is the only failure here that puts a wrong number in someone's finances.
  if (!String(text).trim()) reviewReasons.push(REVIEW_REASONS.NO_TEXT_RECOGNISED);
  if (amount.value === null) reviewReasons.push(REVIEW_REASONS.NO_AMOUNT_FOUND);
  if (amount.ambiguous) reviewReasons.push(REVIEW_REASONS.AMBIGUOUS_AMOUNT);
  if (isLow(fieldConfidence.expenseAmount)) reviewReasons.push(REVIEW_REASONS.LOW_AMOUNT_CONFIDENCE);
  if (date.value === null) reviewReasons.push(REVIEW_REASONS.NO_DATE_FOUND);
  if (isLow(fieldConfidence.expenseDate)) reviewReasons.push(REVIEW_REASONS.LOW_DATE_CONFIDENCE);
  if (looksLikeHeading(expenseName)) reviewReasons.push(REVIEW_REASONS.MERCHANT_LOOKS_LIKE_HEADING);
  if (isLow(overallConfidence)) reviewReasons.push(REVIEW_REASONS.LOW_OVERALL_CONFIDENCE);

  // needsReview keeps its exact previous meaning for existing callers
  // (billController.js and the T06 review UI both read it): no amount found,
  // or a known-low overall confidence. The richer reasons are ADDITIVE --
  // widening needsReview to cover every new reason would have changed the
  // behaviour of shipped UI in the same commit that introduced the reasons,
  // making any resulting regression ambiguous between the two.
  const needsReview =
    amount.value === null || isLow(overallConfidence);

  return {
    expenseName,
    expenseAmount: amount.value,
    expenseDate: date.value,
    overallConfidence,
    fieldConfidence,
    needsReview,
    // New in T04. `amountCandidates` is what makes AMBIGUOUS_AMOUNT
    // actionable: the UI can offer the competing totals rather than telling
    // the user something is uncertain and leaving them to find it.
    reviewReasons,
    amountCandidates: amount.candidates,
  };
};

module.exports = {
  parseReceipt,
  REVIEW_REASONS,
  LOW_CONFIDENCE_THRESHOLD,
};
