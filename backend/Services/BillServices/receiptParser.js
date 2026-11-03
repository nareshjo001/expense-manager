// G. 34) for a malformed OCR match.
"use strict";

const { toOcrResult } = require("./ocrContract");
const {
  extractMerchant,
  extractAmount,
  extractDate,
  looksLikeHeading,
} = require("./receiptExtractors");

// Below this, a field is worth a second look.
const LOW_CONFIDENCE_THRESHOLD = 60;

// Machine-readable reasons, not just a boolean.
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

// Look up the OCR confidence of whatever text a field was extracted from, by finding the OCR line it came from.
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

// Extract the expense fields the client needs from OCR output.
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

  // Ordered most to least consequential, so a UI that shows only the first reason still shows the one that matters most.
  if (!String(text).trim()) reviewReasons.push(REVIEW_REASONS.NO_TEXT_RECOGNISED);
  if (amount.value === null) reviewReasons.push(REVIEW_REASONS.NO_AMOUNT_FOUND);
  if (amount.ambiguous) reviewReasons.push(REVIEW_REASONS.AMBIGUOUS_AMOUNT);
  if (isLow(fieldConfidence.expenseAmount)) reviewReasons.push(REVIEW_REASONS.LOW_AMOUNT_CONFIDENCE);
  if (date.value === null) reviewReasons.push(REVIEW_REASONS.NO_DATE_FOUND);
  if (isLow(fieldConfidence.expenseDate)) reviewReasons.push(REVIEW_REASONS.LOW_DATE_CONFIDENCE);
  if (looksLikeHeading(expenseName)) reviewReasons.push(REVIEW_REASONS.MERCHANT_LOOKS_LIKE_HEADING);
  if (isLow(overallConfidence)) reviewReasons.push(REVIEW_REASONS.LOW_OVERALL_CONFIDENCE);

  // Js and the T06 review UI both read it): no amount found, or a known-low overall confidence.
  const needsReview =
    amount.value === null || isLow(overallConfidence);

  return {
    expenseName,
    expenseAmount: amount.value,
    expenseDate: date.value,
    overallConfidence,
    fieldConfidence,
    needsReview,
    // New in T04. `amountCandidates` is what makes AMBIGUOUS_AMOUNT actionable: the UI can offer the competing totals rather than telling the user.
    reviewReasons,
    amountCandidates: amount.candidates,
  };
};

module.exports = {
  parseReceipt,
  REVIEW_REASONS,
  LOW_CONFIDENCE_THRESHOLD,
};
