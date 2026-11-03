"use strict";

// Js). js's split: the smallest testable unit here is one comparison rule, not a whole evaluation run.

// Confidence-derived review reasons depend on Tesseract's actual recognition quality (font rendering, anti-aliasing -- whatever the real engine decides), which this harness cannot predict for a synthetically rendered image.
const CONFIDENCE_REVIEW_REASONS = new Set([
  "LOW_OVERALL_CONFIDENCE",
  "LOW_AMOUNT_CONFIDENCE",
  "LOW_DATE_CONFIDENCE",
]);

const stripConfidenceReasons = (reasons) =>
  (Array.isArray(reasons) ? reasons : []).filter((r) => !CONFIDENCE_REVIEW_REASONS.has(r));

// Js says so plainly. Comparing it to a human-curated "true merchant name" with strict equality would fail on any receipt whose first two word.
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

// Js forwards expenseDate untouched). This harness has to parse it itself to compare against a ground-truth calendar date.
const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const MONTH_INDEX = new Map();
MONTH_NAMES.forEach((name, i) => {
  MONTH_INDEX.set(name, i);
  MONTH_INDEX.set(name.slice(0, 3), i); // "sep", "jan", ...
});

// Builds an ISO date string and confirms day/month actually round-trip (native Date silently rolls "31 Feb" over into March; comparing the constructed date's own fields back against the inputs catches that).
const toIsoIfValid = (year, monthIndex, day) => {
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11 || !Number.isFinite(day)) return null;
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthIndex || date.getUTCDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const NUMERIC_DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/;
const WORDED_DATE = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})$/;

const parseExtractedDate = (matchedText) => {
  const text = String(matchedText ?? "").trim();
  if (!text) return null;

  // Js); this harness must be able to read that shape back too, or a correctly extracted ISO date would be mis-scored as a mismatch by the day-first numeric parsing below.
  const iso = text.match(ISO_DATE);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    return toIsoIfValid(year, month - 1, day);
  }

  const numeric = text.match(NUMERIC_DATE);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const yearDigits = numeric[3];
    const year = yearDigits.length <= 2 ? Number(yearDigits) + 2000 : Number(yearDigits);
    return toIsoIfValid(year, month - 1, day);
  }

  const worded = text.match(WORDED_DATE);
  if (worded) {
    const day = Number(worded[1]);
    const monthIndex = MONTH_INDEX.get(worded[2].toLowerCase());
    const year = Number(worded[3]);
    if (monthIndex === undefined) return null;
    return toIsoIfValid(year, monthIndex, day);
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

// Json record; `parsed` is parseReceipt()'s return value for that entry's image.
const scoreEntry = (entry, parsed) => {
  const groundTruth = entry.groundTruth || {};
  const merchantMatch = merchantMatches(parsed.expenseName, groundTruth.expenseName);
  const amountMatch = amountMatches(parsed.expenseAmount, groundTruth.expenseAmount);
  const dateMatch = dateMatches(parsed.expenseDate, groundTruth.expenseDate);
  const reasonsMatch =
    groundTruth.expectReviewReasons === undefined
      ? null // not asserted for this entry
      : reviewReasonsMatch(parsed.reviewReasons, groundTruth.expectReviewReasons);

  // The pass/fail gate deliberately excludes merchant (informational only, see above).
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
  parseExtractedDate,
  dateMatches,
  reviewReasonsMatch,
  scoreEntry,
  aggregateScores,
};
