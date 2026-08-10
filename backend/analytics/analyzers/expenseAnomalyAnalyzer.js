// Phase 1 (V1): a pure, deterministic expense-anomaly analyzer.
//
// Scope boundary: this file performs NO database, Redis, filesystem, HTTP,
// ML-service, or provider calls itself -- reportGenerator.js is the only
// caller, feeding it exclusively provider/context data (see the `analyze`
// call site there) and storing its return value unmodified on the
// generated report's `anomalies` section. Calling `analyze()` here has no
// side effects at all; it is a pure statistical function used by the report
// pipeline, not a standalone service.
//
// Detects expenses that are unusually LARGE relative to the authenticated
// user's own historical spending in the exact same stored category --
// never relative to other users, never relative to a different category,
// and never in the downward direction (refunds/small expenses are out of
// scope by design). This is a personal-history observation, not a fraud,
// wrongdoing, or "financial problem" signal.
"use strict";

const { anomaly: RULES } = require("./scores/expenseAnomalyRules");

// Narrowly guarded numeric coercion -- Number() throws for a Symbol, and
// can throw for an object with no usable valueOf/toString (e.g. an
// Object.create(null) value, or one with a deliberately throwing
// valueOf/toString). Any such value is simply invalid data to skip, the
// same as a non-finite result -- this is not a broad try/catch around the
// analyzer's own logic, only around this one primitive coercion.
const toFiniteAmount = (value) => {
  let num;
  try {
    num = Number(value);
  } catch {
    return null;
  }
  return Number.isFinite(num) ? num : null;
};

const parseDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const round2 = (value) => Number(Number(value).toFixed(2));

const isNonBlankString = (value) => typeof value === "string" && value.trim() !== "";

// The single, safe identifier-serialization helper. Coerces `_id` to a
// string exactly once; a missing, blank, or uncoercible value (including a
// stateful or throwing toString()) is treated as invalid and rejected
// without ever crashing analyze(). The original `_id` value itself is
// never retained or exposed -- only this serialized string is.
const serializeId = (value) => {
  if (value === undefined || value === null) return null;

  let asString;
  try {
    asString = String(value).trim();
  } catch {
    return null;
  }

  return asString === "" ? null : asString;
};

// Unrounded median -- calculations must stay unrounded until public output.
const median = (numbers) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Median Absolute Deviation, unrounded. MAD's 50% breakdown point means the
// baseline is not dragged upward by the very outliers being detected.
const medianAbsoluteDeviation = (numbers, numbersMedian) => {
  const deviations = numbers.map((n) => Math.abs(n - numbersMedian));
  return median(deviations);
};

// Builds one candidate record from a raw expense, or null if it fails any
// eligibility check. Never mutates the source `expense` object.
const toCandidate = (expense, monthStart, monthEndExclusive) => {
  if (!expense || typeof expense !== "object") return null;

  const amount = toFiniteAmount(expense.expenseAmount);
  if (amount === null || amount <= 0) return null; // refunds/zero excluded; upper-tail only

  if (!isNonBlankString(expense.expenseCategory)) return null;

  // Coerced exactly once here; this same string is reused as the public
  // `expenseId` later -- never re-derived, never the raw `_id` value.
  const id = serializeId(expense._id);
  if (id === null) return null;

  const date = parseDate(expense.expenseDate);
  if (!date) return null;
  if (date < monthStart || date >= monthEndExclusive) return null; // must fall within the analysis month

  return {
    id,
    name: isNonBlankString(expense.expenseName) ? expense.expenseName : "",
    category: expense.expenseCategory, // exact stored value, no normalization
    amount,
    date,
  };
};

// True when a baseline record is a valid, in-window, same-category,
// positive-amount historical data point. `category` must match the
// candidate's exact stored category string -- no case-folding, no trimming.
const isValidBaselineRecord = (expense, category, baselineStart, baselineEndExclusive) => {
  if (!expense || typeof expense !== "object") return false;
  if (expense.expenseCategory !== category) return false;

  const amount = toFiniteAmount(expense.expenseAmount);
  if (amount === null || amount <= 0) return false;

  const date = parseDate(expense.expenseDate);
  if (!date) return false;
  if (date < baselineStart || date >= baselineEndExclusive) return false;

  return true;
};

const severityForMultiple = (thresholdMultiple) => {
  const tier = RULES.severityTiers.find((t) => thresholdMultiple < t.max);
  return tier ? tier.label : RULES.severityTiers[RULES.severityTiers.length - 1].label;
};

// Deterministic tie-break chain: thresholdMultiple desc, amount desc,
// expenseDate desc, expenseId lexicographically (ascending).
const compareAnomalies = (a, b) => {
  if (b._sortMultiple !== a._sortMultiple) return b._sortMultiple - a._sortMultiple;
  if (b._sortAmount !== a._sortAmount) return b._sortAmount - a._sortAmount;
  const dateDiff = b._sortDate.getTime() - a._sortDate.getTime();
  if (dateDiff !== 0) return dateDiff;
  if (a.expenseId < b.expenseId) return -1;
  if (a.expenseId > b.expenseId) return 1;
  return 0;
};

/**
 * @param {object} input
 * @param {Array} input.currentMonthExpenses - candidate pool (this analysis month only)
 * @param {Array} input.recentExpensePool - historical pool to draw the baseline from (may
 *   legitimately include current-month records; they are excluded by date, not by identity)
 * @param {Date} input.currentMonthStart - explicit, injectable anchor date (first instant of
 *   the analysis month). This function never calls `new Date()` to discover "now".
 */
const analyze = ({ currentMonthExpenses = [], recentExpensePool = [], currentMonthStart } = {}) => {
  const monthStart = currentMonthStart instanceof Date ? currentMonthStart : parseDate(currentMonthStart);

  const emptyResult = (reasonCode, extra = {}) => ({
    hasData: false,
    reasonCode,
    baselineWindow: {
      months: RULES.baselineWindowMonths,
      start: null,
      endExclusive: null,
    },
    evaluatedExpenseCount: 0,
    eligibleCategoryCount: 0,
    insufficientHistoryCategoryCount: 0,
    flaggedCount: 0,
    anomalies: [],
    ...extra,
  });

  if (!monthStart || Number.isNaN(monthStart.getTime())) {
    // Malformed/missing anchor date -- no month can be evaluated. Fails
    // safe rather than guessing or throwing.
    return emptyResult("NO_ELIGIBLE_CURRENT_EXPENSES");
  }

  const monthEndExclusive = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  const baselineStart = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth() - RULES.baselineWindowMonths,
    1
  );
  const baselineWindow = {
    months: RULES.baselineWindowMonths,
    start: baselineStart.toISOString(),
    endExclusive: monthStart.toISOString(),
  };

  const candidateSource = Array.isArray(currentMonthExpenses) ? currentMonthExpenses : [];
  const candidates = candidateSource
    .map((expense) => toCandidate(expense, monthStart, monthEndExclusive))
    .filter(Boolean);

  if (candidates.length === 0) {
    return emptyResult("NO_ELIGIBLE_CURRENT_EXPENSES", { baselineWindow });
  }

  const baselineSource = Array.isArray(recentExpensePool) ? recentExpensePool : [];

  // Only compute baselines for categories that at least one candidate
  // actually needs -- matches how eligibleCategoryCount /
  // insufficientHistoryCategoryCount are defined (over candidate
  // categories), and avoids wasted work over irrelevant categories.
  const candidateCategories = [...new Set(candidates.map((c) => c.category))];

  const categoryStats = new Map();
  let eligibleCategoryCount = 0;
  let insufficientHistoryCategoryCount = 0;

  for (const category of candidateCategories) {
    const baselineAmounts = baselineSource
      .filter((expense) => isValidBaselineRecord(expense, category, baselineStart, monthStart))
      .map((expense) => toFiniteAmount(expense.expenseAmount));

    if (baselineAmounts.length < RULES.minBaselineSampleSize) {
      insufficientHistoryCategoryCount += 1;
      continue;
    }

    const categoryMedian = median(baselineAmounts);
    const categoryMad = medianAbsoluteDeviation(baselineAmounts, categoryMedian);

    categoryStats.set(category, {
      sampleCount: baselineAmounts.length,
      median: categoryMedian,
      mad: categoryMad,
    });
    eligibleCategoryCount += 1;
  }

  if (eligibleCategoryCount === 0) {
    return emptyResult("NO_BASELINE_YET", {
      baselineWindow,
      evaluatedExpenseCount: candidates.length,
      insufficientHistoryCategoryCount,
    });
  }

  const flagged = [];

  for (const candidate of candidates) {
    const stats = categoryStats.get(candidate.category);
    if (!stats) continue; // ineligible category -- not evaluated, not counted as flagged

    if (stats.median <= 0) continue; // defensive: cannot happen given positive baseline amounts

    const amountRatio = candidate.amount / stats.median;

    let method = null;
    let methodScore = null;
    let methodThreshold = null;
    let isFlagged = false;

    if (stats.mad > 0) {
      const modifiedZ = (RULES.modifiedZ.constant * (candidate.amount - stats.median)) / stats.mad;
      method = "MODIFIED_Z";
      methodScore = modifiedZ;
      methodThreshold = RULES.modifiedZ.threshold;
      isFlagged = modifiedZ >= RULES.modifiedZ.threshold && amountRatio >= RULES.modifiedZ.minAmountRatio;
    } else {
      // MAD === 0 (median > 0, guaranteed above) -- degenerate-dispersion fallback.
      method = "MEDIAN_RATIO";
      methodScore = amountRatio;
      methodThreshold = RULES.medianRatio.threshold;
      isFlagged = amountRatio >= RULES.medianRatio.threshold;
    }

    if (!isFlagged) continue;

    const thresholdMultiple = methodScore / methodThreshold;

    flagged.push({
      expenseId: candidate.id,
      expenseName: candidate.name,
      category: candidate.category,
      amount: round2(candidate.amount),
      expenseDate: candidate.date.toISOString(),
      severity: severityForMultiple(thresholdMultiple),
      reasonCode: RULES.reasonCode,
      baseline: {
        scope: "category",
        sampleCount: stats.sampleCount,
        medianAmount: round2(stats.median),
      },
      detection: {
        method,
        score: round2(methodScore),
        threshold: methodThreshold,
        thresholdMultiple: round2(thresholdMultiple),
        amountRatio: round2(amountRatio),
      },
      // Sort keys only -- stripped before the value is returned.
      _sortMultiple: thresholdMultiple,
      _sortAmount: candidate.amount,
      _sortDate: candidate.date,
    });
  }

  flagged.sort(compareAnomalies);

  const anomalies = flagged
    .slice(0, RULES.maxAnomalies)
    .map(({ _sortMultiple, _sortAmount, _sortDate, ...anomalyRecord }) => anomalyRecord);

  return {
    hasData: true,
    reasonCode: null,
    baselineWindow,
    evaluatedExpenseCount: candidates.length,
    eligibleCategoryCount,
    insufficientHistoryCategoryCount,
    flaggedCount: anomalies.length,
    anomalies,
  };
};

module.exports = {
  analyze,
};
