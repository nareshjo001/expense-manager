// Prediction Layer V1: per-category next-month forecast allocation.
//
// Answers "which categories are expected to contribute most next month?"
// without ever inventing a category list: every category here is discovered
// dynamically from the user's own aggregated history, so a user with three
// categories and a user with forty are both handled by the same code with
// no fixed list, no fixed count, and no hard-coded names anywhere.
//
// Aggregate-input boundary (identical guarantee to forecastAnalyzer.js):
// this module NEVER receives or reads a raw expense record. Its only input
// is `categorySeries` -- an already-aggregated
// `{ category, monthlySeries: [{ monthKey, totalAmount }] }` array built by
// analytics/forecastInputAggregator.js. No line here reads `_id`,
// `expenseName`, `userId`, or an individual `expenseDate`/`expenseAmount`.
//
// Method (deliberately simple and validated, never a "trendy" model):
//   1. A category with at least `RULES.category.minMonthsForOwnTrend`
//      observed months is projected with EXACTLY the same Theil-Sen robust
//      trend the overall forecast uses -- literally forecastAnalyzer.js's
//      own exported `fitRobustTrend`, not a second divergent method -- then
//      floored at zero (spending cannot be negative).
//   2. A sparse/intermittent category (fewer observed months than that)
//      falls back to its recent SMOOTHED SHARE of total spending, averaged
//      over the trailing `RULES.category.shareSmoothingMonths` observed
//      months, applied to the overall predicted total. Fitting a trend to
//      one or two sparse points would be noise presented as signal.
//   3. Every raw prediction is then reconciled proportionally so the
//      category amounts sum to the already-published overall next-month
//      estimate -- the overall number is the source of truth and is never
//      altered to match the parts.
//   4. Rounding uses the largest-remainder method over integer paise, so
//      the ROUNDED amounts sum EXACTLY to the overall estimate rather than
//      drifting by a few paise. Ties break on category name ascending, so
//      the output is fully deterministic for identical input.
//
// Pure and deterministic: no DB/Redis/HTTP access, no zero-argument
// `new Date()`, no randomness, no mutation of its inputs.
"use strict";

const { forecast: RULES } = require("./scores/forecastRules");
// Imported from the shared trend module (NOT from forecastAnalyzer.js) so
// the overall forecast and this breakdown provably use the same function
// with no circular dependency between the two analyzers.
const { fitRobustTrend } = require("./robustTrend");

const round2 = (value) => Number(Number(value).toFixed(2));

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

const MONTH_KEY_PATTERN = /^(-?\d+)-(\d+)$/;

// Same calendar-month ordinal space forecastAnalyzer.js uses, so a gap
// between observed months is arithmetically visible to the trend fit here
// too (January -> March is 2 months apart, never 1).
function monthKeyToOrdinal(monthKey) {
  const match = typeof monthKey === "string" ? MONTH_KEY_PATTERN.exec(monthKey) : null;
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return null;
  return year * 12 + monthIndex;
}

// Validates one category's series into ascending `{ ordinal, total }`
// points. Malformed entries are dropped, never thrown; same-ordinal
// duplicates are summed (defense in depth -- the aggregator's own Map
// keying already prevents them).
function sanitizeCategorySeries(monthlySeries) {
  const source = Array.isArray(monthlySeries) ? monthlySeries : [];
  const byOrdinal = new Map();

  for (const entry of source) {
    if (!entry || typeof entry !== "object") continue;
    const ordinal = monthKeyToOrdinal(entry.monthKey);
    if (ordinal === null) continue;
    let amount;
    try {
      amount = Number(entry.totalAmount);
    } catch {
      continue;
    }
    if (!Number.isFinite(amount)) continue;
    byOrdinal.set(ordinal, (byOrdinal.get(ordinal) ?? 0) + amount);
  }

  return [...byOrdinal.entries()]
    .map(([ordinal, total]) => ({ ordinal, total }))
    .sort((a, b) => a.ordinal - b.ordinal);
}

// Mean of a category's share of the overall monthly total, averaged over
// the trailing months of its ALIGNED series.
//
// Because `points` is zero-filled against the canonical completed-month
// timeline, a month in which the user spent elsewhere but nothing in this
// category contributes a genuine 0% share to the average -- which is the
// whole point: an intermittent category's average share must be dragged
// down by the months it was absent. Only a month where the user spent
// nothing AT ALL is skipped (it would be a 0/0), never a month where this
// category alone was zero.
function smoothedShare(points, totalsByOrdinal) {
  const recent = points.slice(-RULES.category.shareSmoothingMonths);
  const shares = [];

  for (const point of recent) {
    const monthTotal = totalsByOrdinal.get(point.ordinal);
    if (!isFiniteNumber(monthTotal) || monthTotal <= 0) continue;
    shares.push(point.total / monthTotal);
  }

  if (shares.length === 0) return 0;
  return shares.reduce((sum, share) => sum + share, 0) / shares.length;
}

/**
 * Largest-remainder rounding over integer paise.
 *
 * Guarantees `sum(result) === targetTotal` exactly (to 2dp) whenever
 * `targetTotal` is itself a 2dp value, which it always is here (the overall
 * estimate is already `round2`-ed before it reaches this module). Without
 * this, independently rounding each category would leave the parts summing
 * to something a paisa or two away from the published total -- exactly the
 * kind of small inconsistency that makes a financial figure look untrustworthy.
 *
 * Deterministic tie-breaking: entries are compared by fractional remainder
 * descending, then by category name ascending, so identical input always
 * produces byte-identical output regardless of Array.prototype.sort's
 * stability characteristics.
 */
function roundToExactTotal(entries, targetTotal) {
  const targetPaise = Math.round(targetTotal * 100);

  const withPaise = entries.map((entry) => {
    const exactPaise = entry.amount * 100;
    const floorPaise = Math.floor(exactPaise);
    return { ...entry, floorPaise, remainder: exactPaise - floorPaise };
  });

  const distributedPaise = withPaise.reduce((sum, entry) => sum + entry.floorPaise, 0);
  let leftover = targetPaise - distributedPaise;

  // Ordering used to hand out (or claw back) the leftover paise.
  const byRemainder = [...withPaise].sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.category < b.category ? -1 : a.category > b.category ? 1 : 0;
  });

  const bonusByCategory = new Map();

  if (leftover > 0) {
    for (let i = 0; leftover > 0 && byRemainder.length > 0; i += 1) {
      const entry = byRemainder[i % byRemainder.length];
      bonusByCategory.set(entry.category, (bonusByCategory.get(entry.category) ?? 0) + 1);
      leftover -= 1;
    }
  } else if (leftover < 0) {
    // Defensive: floor() can never overshoot, so this branch is unreachable
    // for well-formed input. Kept so a future change cannot silently
    // produce parts that exceed the published total.
    const ascending = [...byRemainder].reverse();
    for (let i = 0; leftover < 0 && ascending.length > 0; i += 1) {
      const entry = ascending[i % ascending.length];
      const currentBonus = bonusByCategory.get(entry.category) ?? 0;
      if (entry.floorPaise + currentBonus <= 0) continue;
      bonusByCategory.set(entry.category, currentBonus - 1);
      leftover += 1;
    }
  }

  return withPaise.map((entry) => ({
    category: entry.category,
    method: entry.method,
    predictedAmount: round2((entry.floorPaise + (bonusByCategory.get(entry.category) ?? 0)) / 100),
  }));
}

/**
 * @param {object} input
 * @param {Array<{category: string, monthlySeries: Array<{monthKey: string, totalAmount: number}>}>} input.categorySeries -
 *   aggregate-only per-category history from forecastInputAggregator.js.
 *   Never raw expense records.
 * @param {number|null} input.predictedTotal - the already-published overall
 *   next-month estimate this breakdown must reconcile to.
 * @param {number} input.anchorOrdinal - the target month's calendar-month
 *   ordinal (the same anchor the overall forecast projects to).
 * @returns {{hasData: boolean, reasonCode: string|null,
 *   categories: Array<{category: string, predictedAmount: number,
 *   sharePercentage: number, method: string}>}}
 */
function allocate({ categorySeries = [], predictedTotal, anchorOrdinal } = {}) {
  const empty = (reasonCode) => ({ hasData: false, reasonCode, categories: [] });

  if (!isFiniteNumber(predictedTotal) || predictedTotal <= 0) {
    return empty(RULES.reasonCodes.noCategoryBreakdown);
  }
  if (!isFiniteNumber(anchorOrdinal)) {
    return empty(RULES.reasonCodes.noCategoryBreakdown);
  }

  const source = Array.isArray(categorySeries) ? categorySeries : [];

  // Normalize every category first, so the overall per-month totals used by
  // the share fallback are derived from the SAME sanitized points the trend
  // fits use -- not from a separately-computed number that could disagree.
  const normalized = [];
  const totalsByOrdinal = new Map();

  for (const entry of source) {
    if (!entry || typeof entry !== "object") continue;
    const category = typeof entry.category === "string" ? entry.category.trim() : "";
    if (category === "") continue;

    const points = sanitizeCategorySeries(entry.monthlySeries);
    if (points.length === 0) continue;

    normalized.push({ category, points });
    for (const point of points) {
      totalsByOrdinal.set(point.ordinal, (totalsByOrdinal.get(point.ordinal) ?? 0) + point.total);
    }
  }

  if (normalized.length === 0) {
    return empty(RULES.reasonCodes.noCategoryBreakdown);
  }

  // Raw (pre-reconciliation) prediction per category.
  //
  // `points` is the ALIGNED series (zero-filled against the canonical
  // completed-month timeline), so a month in which this category recorded
  // nothing is a real observation of 0 here rather than a missing point.
  // Eligibility for a category's own trend therefore checks BOTH the
  // aligned timeline length AND how many months carried actual spending --
  // see forecastRules.js for why either check alone is insufficient.
  const raw = normalized.map(({ category, points }) => {
    const nonZeroMonths = points.filter((point) => point.total > 0).length;

    const presenceRatio = points.length > 0 ? nonZeroMonths / points.length : 0;

    if (
      points.length >= RULES.category.minMonthsForOwnTrend &&
      nonZeroMonths >= RULES.category.minNonZeroMonthsForOwnTrend &&
      presenceRatio >= RULES.category.minNonZeroRatioForOwnTrend
    ) {
      const { intercept, slope } = fitRobustTrend(points);
      const projected = intercept + slope * anchorOrdinal;
      return {
        category,
        method: RULES.category.methods.ownTrend,
        amount: Math.max(0, projected),
      };
    }

    return {
      category,
      method: RULES.category.methods.smoothedShare,
      amount: Math.max(0, smoothedShare(points, totalsByOrdinal) * predictedTotal),
    };
  });

  const rawSum = raw.reduce((sum, entry) => sum + entry.amount, 0);

  // Every category's own trend projected to zero (e.g. a uniformly
  // collapsing history) while the overall estimate is still positive.
  // Rather than fabricating a split, fall back to smoothed shares for ALL
  // categories; if those are also all zero, report no breakdown honestly.
  let reconciledBasis = raw;
  if (rawSum <= 0) {
    const shareBased = normalized.map(({ category, points }) => ({
      category,
      method: RULES.category.methods.smoothedShare,
      amount: Math.max(0, smoothedShare(points, totalsByOrdinal) * predictedTotal),
    }));
    const shareSum = shareBased.reduce((sum, entry) => sum + entry.amount, 0);
    if (shareSum <= 0) {
      return empty(RULES.reasonCodes.noCategoryBreakdown);
    }
    reconciledBasis = shareBased;
  }

  const basisSum = reconciledBasis.reduce((sum, entry) => sum + entry.amount, 0);
  const scale = predictedTotal / basisSum;

  const scaled = reconciledBasis.map((entry) => ({
    category: entry.category,
    method: entry.method,
    amount: entry.amount * scale,
  }));

  const rounded = roundToExactTotal(scaled, predictedTotal);

  const categories = rounded
    .map((entry) => ({
      category: entry.category,
      predictedAmount: entry.predictedAmount,
      // Derived from the FINAL reconciled amount, so the displayed share
      // always matches the displayed amount. Shares are rounded
      // independently and are therefore indicative -- the amounts, not the
      // percentages, are the reconciled figures.
      sharePercentage: round2((entry.predictedAmount / predictedTotal) * 100),
      method: entry.method,
    }))
    .sort((a, b) => {
      if (b.predictedAmount !== a.predictedAmount) return b.predictedAmount - a.predictedAmount;
      return a.category < b.category ? -1 : a.category > b.category ? 1 : 0;
    });

  return { hasData: true, reasonCode: null, categories };
}

module.exports = {
  allocate,
};
