// Per-category next-month forecast allocation. Categories are discovered dynamically from the user's own aggregated history -- no fixed list. Aggregate-input boundary identical to forecastAnalyzer.js: only reads already-aggregated `categorySeries`, never a raw expense record. Method: a category with enough observed months is projected with the same Theil-Sen trend the overall forecast uses (floored at zero); a sparse category falls back to its recent smoothed share of total spending; every raw prediction is then reconciled proportionally to the already-published overall estimate; final rounding uses the largest-remainder method over integer paise so amounts sum exactly to the total. Pure and deterministic -- no DB/Redis/HTTP, no randomness, no mutation of inputs.
"use strict";

const { forecast: RULES } = require("./scores/forecastRules");
// Imported from the shared trend module, not forecastAnalyzer.js, so the overall forecast and this breakdown provably use the same function with no circular dependency.
const { fitRobustTrend } = require("./robustTrend");

const round2 = (value) => Number(Number(value).toFixed(2));

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

const MONTH_KEY_PATTERN = /^(-?\d+)-(\d+)$/;

// Same calendar-month ordinal space forecastAnalyzer.js uses, so a gap between observed months is arithmetically visible here too.
function monthKeyToOrdinal(monthKey) {
  const match = typeof monthKey === "string" ? MONTH_KEY_PATTERN.exec(monthKey) : null;
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return null;
  return year * 12 + monthIndex;
}

// Validates one category's series into ascending {ordinal, total} points. Malformed entries are dropped, never thrown; same-ordinal duplicates are summed (defense in depth -- the aggregator's own Map keying already prevents them).
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

// Mean of a category's share of the overall monthly total, averaged over the trailing months of its aligned (zero-filled) series -- a month where this category was absent contributes a genuine 0% share, dragging down an intermittent category's average as intended; only a month with zero total spending anywhere is skipped (it would be a 0/0).
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

// Largest-remainder rounding over integer paise -- guarantees sum(result) === targetTotal exactly, since independently rounding each category would leave the parts a paisa or two off the published total. Deterministic tie-breaking: remainder descending, then category name ascending, so identical input always produces identical output.
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
    // Defensive: floor() can never overshoot, so unreachable for well-formed input -- kept so a future change can't silently produce parts exceeding the total.
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
 * @param {number|null} input.predictedTotal - the already-published overall next-month estimate this breakdown must reconcile to.
 * @param {number} input.anchorOrdinal - the target month's calendar-month ordinal.
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

  // Normalize every category first, so the per-month totals used by the share fallback are derived from the same sanitized points the trend fits use.
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

  // Raw (pre-reconciliation) prediction per category. `points` is the aligned (zero-filled) series, so eligibility for a category's own trend checks both the timeline length and how many months carried actual spending -- see forecastRules.js for why either check alone is insufficient.
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

  // Every category's own trend projected to zero while the overall estimate is still positive -- rather than fabricating a split, fall back to smoothed shares for all categories; if those are also zero, report no breakdown honestly.
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
      // Derived from the final reconciled amount so the displayed share matches the displayed amount; shares are rounded independently and are indicative -- amounts are the reconciled figures.
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
