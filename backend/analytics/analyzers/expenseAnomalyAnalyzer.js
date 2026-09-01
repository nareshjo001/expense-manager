// A pure, deterministic expense-anomaly analyzer -- no database/Redis/filesystem/HTTP/ML-service calls; reportGenerator.js is the only caller and stores the return value unmodified. Detects expenses unusually large relative to the authenticated user's own historical spending in the exact same category, never relative to other users or categories, and never downward (refunds excluded by design) -- a personal-history observation, not a fraud or "financial problem" signal.
"use strict";

const { anomaly: RULES } = require("./scores/expenseAnomalyRules");
// Category grouping is normalized through the same shared utility forecastInputAggregator.js uses (normalizeCategoryForGrouping), so case/whitespace/alias variants of the same category ("Food"/"food", "Medical"/"Health") share one baseline instead of silently fragmenting sample size on both the candidate and historical sides.
const { normalizeCategoryForGrouping } = require("../../utils/categoryNormalization");

// Narrowly guarded numeric coercion -- Number() can throw for a Symbol or a valueOf/toString-less object; any such value is treated as invalid data to skip, same as a non-finite result.
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

const normalizeExpenseName = (value) =>
  isNonBlankString(value) ? value.trim().replace(/\s+/g, " ").toLowerCase() : null;

// The single, safe identifier-serialization helper -- coerces `_id` to a string exactly once; a missing/blank/uncoercible value is rejected without crashing analyze(). The original `_id` is never retained or exposed, only this serialized string.
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

const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const buildStats = (records) => {
  const amounts = records.map((record) => record.amount);
  const amountMedian = median(amounts);
  return {
    sampleCount: amounts.length,
    monthCount: new Set(records.map((record) => monthKey(record.date))).size,
    median: amountMedian,
    mad: medianAbsoluteDeviation(amounts, amountMedian),
  };
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
    // Canonical grouping value (categoryNormalization.js), not the raw
    category: normalizeCategoryForGrouping(expense.expenseCategory),
    normalizedName: normalizeExpenseName(expense.expenseName),
    amount,
    date,
  };
};

// True when a baseline record is a valid, in-window, same-category, positive-amount historical data point -- normalizes the baseline record's raw category through the same shared utility before comparing, so historical-side variants converge on the same baseline as the candidate side.
const toBaselineRecord = (expense, category, baselineStart, baselineEndExclusive) => {
  if (!expense || typeof expense !== "object") return null;
  if (normalizeCategoryForGrouping(expense.expenseCategory) !== category) return null;

  const amount = toFiniteAmount(expense.expenseAmount);
  if (amount === null || amount <= 0) return null;

  const date = parseDate(expense.expenseDate);
  if (!date) return null;
  if (date < baselineStart || date >= baselineEndExclusive) return null;

  return {
    amount,
    date,
    normalizedName: normalizeExpenseName(expense.expenseName),
  };
};

const buildHistoricalMonthlyReference = (expenses, baselineStart, baselineEndExclusive) => {
  const totals = new Map();
  for (const expense of expenses) {
    if (!expense || typeof expense !== "object") continue;
    const amount = toFiniteAmount(expense.expenseAmount);
    const date = parseDate(expense.expenseDate);
    if (amount === null || amount <= 0 || !date || date < baselineStart || date >= baselineEndExclusive) continue;
    const key = monthKey(date);
    totals.set(key, (totals.get(key) || 0) + amount);
  }
  const activeMonthTotals = [...totals.values()].filter((amount) => amount > 0);
  return activeMonthTotals.length > 0 ? median(activeMonthTotals) : null;
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

/* @param {object} input */
const analyze = ({
  currentMonthExpenses = [],
  recentExpensePool = [],
  currentMonthStart,
  monthlyReferenceAmount,
} = {}) => {
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
  const suppliedReference = toFiniteAmount(monthlyReferenceAmount);
  const historicalReference = buildHistoricalMonthlyReference(baselineSource, baselineStart, monthStart);
  const monthlyReference = suppliedReference !== null && suppliedReference > 0
    ? suppliedReference
    : historicalReference;
  const monthlyReferenceSource = suppliedReference !== null && suppliedReference > 0
    ? "current_budget"
    : "historical_monthly_spending";

  // Only compute baselines for categories at least one candidate needs -- matches how eligibleCategoryCount/insufficientHistoryCategoryCount are defined and avoids wasted work.
  const candidateCategories = [...new Set(candidates.map((c) => c.category))];

  const categoryRecords = new Map();
  const categoryStats = new Map();

  for (const category of candidateCategories) {
    const baselineRecords = baselineSource
      .map((expense) => toBaselineRecord(expense, category, baselineStart, monthStart))
      .filter(Boolean);
    categoryRecords.set(category, baselineRecords);

    if (baselineRecords.length >= RULES.minBaselineSampleSize) {
      categoryStats.set(category, {
        records: baselineRecords,
        ...buildStats(baselineRecords),
      });
    }
  }

  const flagged = [];
  let comparedExpenseCount = 0;
  const comparedCategories = new Set();

  for (const candidate of candidates) {
    const categoryBaseline = categoryStats.get(candidate.category);
    const allCategoryRecords = categoryRecords.get(candidate.category) || [];
    const matchingNameRecords = candidate.normalizedName
      ? allCategoryRecords.filter((record) => record.normalizedName === candidate.normalizedName)
      : [];
    const usesNameBaseline = matchingNameRecords.length >= RULES.minNameBaselineSampleSize;
    const stats = usesNameBaseline
      ? buildStats(matchingNameRecords)
      : categoryBaseline;
    if (!stats) continue;

    comparedExpenseCount += 1;
    comparedCategories.add(candidate.category);

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

    const excessAmount = candidate.amount - stats.median;
    const impactRatio = monthlyReference && monthlyReference > 0
      ? excessAmount / monthlyReference
      : 0;
    if (impactRatio < RULES.materiality.minExcessToMonthlyReferenceRatio) continue;

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
        scope: usesNameBaseline ? "expense_name" : "category",
        sampleCount: stats.sampleCount,
        monthCount: stats.monthCount,
        medianAmount: round2(stats.median),
      },
      impact: {
        excessAmount: round2(excessAmount),
        monthlyReferenceAmount: round2(monthlyReference),
        monthlyReferenceSource,
        percentage: round2(impactRatio * 100),
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

  const eligibleCategoryCount = comparedCategories.size;
  const insufficientHistoryCategoryCount = candidateCategories.length - eligibleCategoryCount;

  if (comparedExpenseCount === 0) {
    return emptyResult("NO_BASELINE_YET", {
      baselineWindow,
      evaluatedExpenseCount: candidates.length,
      insufficientHistoryCategoryCount,
    });
  }

  const anomalies = flagged
    .slice(0, RULES.maxAnomalies)
    .map(({ _sortMultiple, _sortAmount, _sortDate, ...anomalyRecord }) => anomalyRecord);

  return {
    hasData: true,
    reasonCode: null,
    baselineWindow,
    evaluatedExpenseCount: candidates.length,
    comparedExpenseCount,
    uncomparableExpenseCount: candidates.length - comparedExpenseCount,
    eligibleCategoryCount,
    insufficientHistoryCategoryCount,
    flaggedCount: flagged.length,
    displayedCount: anomalies.length,
    monthlyReference: {
      amount: monthlyReference === null ? null : round2(monthlyReference),
      source: monthlyReferenceSource,
    },
    anomalies,
  };
};

module.exports = {
  analyze,
};
