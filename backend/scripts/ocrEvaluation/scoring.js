"use strict";

// OCR-003-T07 -- pure comparison/aggregation functions for the evaluation
// harness (runEvaluation.js). Kept dependency-free of any OCR/Tesseract
// call, mirroring receiptExtractors.js's split: the smallest testable unit
// here is one comparison rule, not a whole evaluation run.

const { parse, isValid, format } = require("date-fns");

// Confidence-derived review reasons depend on Tesseract's actual
// recognition quality (font rendering, anti-aliasing -- whatever the real
// engine decides), which this harness cannot predict for a synthetically
// rendered image. Per this task's own scope decision (see
// corpus/README.md), that is not a gap to paper over: confidence/quality
// regressions are exactly the dimension that needs REAL photographed
// receipts (thermal fade, skew, crumpling), not synthetic ones. These three
// codes are therefore excluded from every structural comparison below; they
// still appear in a run's raw `extracted` output for a human to eyeball,
// they are just never asserted on.
const CONFIDENCE_REVIEW_REASONS = new Set([
  "LOW_OVERALL_CONFIDENCE",
  "LOW_AMOUNT_CONFIDENCE",
  "LOW_DATE_CONFIDENCE",
]);

const stripConfidenceReasons = (reasons) =>
  (Array.isArray(reasons) ? reasons : []).filter((r) => !CONFIDENCE_REVIEW_REASONS.has(r));

// --- merchant -----------------------------------------------------------
//
// extractMerchant() is positional (first two words of the whole document),
// not semantic -- receiptExtractors.js says so plainly. Comparing it to a
// human-curated "true merchant name" with strict equality would fail on
// any receipt whose first two words aren't the whole name, which is the
// common case, not an edge case. So this reports agreement via a loose,
// case-insensitive containment check, and it is informational only: it is
// never part of scoreEntry()'s pass/fail gate.
const normalizeMerchant = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const merchantMatches = (extracted, truth) => {
  const a = normalizeMerchant(extracted);
  const b = normalizeMerchant(truth);
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
};

// --- amount ---------------------------------------------------------------
const amountMatches = (extracted, truth) => {
  const a = typeof extracted === "number" ? extracted : null;
  const b = typeof truth === "number" ? truth : null;
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return Math.abs(a - b) < 0.005;
};

// --- date -------------------------------------------------------------
//
// extractDate() returns raw matched OCR text, not a parsed date -- there is
// no downstream date parser in the OCR pipeline today (billController.js
// forwards expenseDate untouched). This harness has to parse it itself to
// compare against a ground-truth calendar date. The app is INR-denominated
// (see utils/money.js), so ambiguous numeric d/m/y text is read day-first,
// matching Indian date convention. That is a scoring assumption made here,
// not a behavior of the pipeline itself, which is why it's spelled out
// rather than left implicit.
const DATE_FORMATS = ["d/M/yyyy", "d-M-yyyy", "d/M/yy", "d-M-yy", "do MMMM yyyy", "d MMMM yyyy"];

const parseExtractedDate = (matchedText) => {
  const text = String(matchedText ?? "").trim();
  if (!text) return null;
  for (const fmt of DATE_FORMATS) {
    const parsed = parse(text, fmt, new Date());
    if (isValid(parsed)) return format(parsed, "yyyy-MM-dd");
  }
  return null;
};

const dateMatches = (extractedMatchedText, truthIsoDate) => {
  const truth = truthIsoDate ? String(truthIsoDate) : null;
  const parsed = parseExtractedDate(extractedMatchedText);
  if (!parsed && !truth) return true;
  if (!parsed || !truth) return false;
  return parsed === truth;
};

// --- reviewReasons ---------------------------------------------------------
const reviewReasonsMatch = (extractedReasons, expectedReasons) => {
  const a = stripConfidenceReasons(extractedReasons).slice().sort();
  const b = stripConfidenceReasons(expectedReasons).slice().sort();
  return a.length === b.length && a.every((v, i) => v === b[i]);
};

// --- one corpus entry -------------------------------------------------
//
// `entry` is one corpus/manifest.json record; `parsed` is parseReceipt()'s
// return value for that entry's image.
const scoreEntry = (entry, parsed) => {
  const groundTruth = entry.groundTruth || {};
  const merchantMatch = merchantMatches(parsed.expenseName, groundTruth.expenseName);
  const amountMatch = amountMatches(parsed.expenseAmount, groundTruth.expenseAmount);
  const dateMatch = dateMatches(parsed.expenseDate, groundTruth.expenseDate);
  const reasonsMatch =
    groundTruth.expectReviewReasons === undefined
      ? null // not asserted for this entry
      : reviewReasonsMatch(parsed.reviewReasons, groundTruth.expectReviewReasons);

  // The pass/fail gate deliberately excludes merchant (informational only,
  // see above). amount and date are the fields that put a number in
  // someone's finances; reviewReasons is graded only when the fixture
  // declares an expectation.
  const passed = amountMatch && dateMatch && reasonsMatch !== false;

  return {
    id: entry.id,
    passed,
    merchantMatch,
    amountMatch,
    dateMatch,
    reasonsMatch,
    extracted: {
      expenseName: parsed.expenseName,
      expenseAmount: parsed.expenseAmount,
      expenseDate: parsed.expenseDate,
      overallConfidence: parsed.overallConfidence,
      needsReview: parsed.needsReview,
      reviewReasons: stripConfidenceReasons(parsed.reviewReasons),
    },
  };
};

const percent = (numerator, denominator) =>
  denominator ? Math.round((numerator / denominator) * 1000) / 10 : 0;

const aggregateScores = (results) => {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const withReasonsAsserted = results.filter((r) => r.reasonsMatch !== null);

  return {
    total,
    passed,
    failed: total - passed,
    passRate: percent(passed, total),
    merchantMatchRate: percent(results.filter((r) => r.merchantMatch).length, total),
    amountMatchRate: percent(results.filter((r) => r.amountMatch).length, total),
    dateMatchRate: percent(results.filter((r) => r.dateMatch).length, total),
    reviewReasonsAssertedCount: withReasonsAsserted.length,
    reviewReasonsPassRate: percent(
      withReasonsAsserted.filter((r) => r.reasonsMatch).length,
      withReasonsAsserted.length
    ),
    failingIds: results.filter((r) => !r.passed).map((r) => r.id),
  };
};

module.exports = {
  CONFIDENCE_REVIEW_REASONS,
  stripConfidenceReasons,
  normalizeMerchant,
  merchantMatches,
  amountMatches,
  DATE_FORMATS,
  parseExtractedDate,
  dateMatches,
  reviewReasonsMatch,
  scoreEntry,
  aggregateScores,
};
