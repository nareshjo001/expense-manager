// Forecasting V2: a pure, deterministic, explicitly-statistical (NOT "AI"
// and NOT machine-learned) spending forecast analyzer.
//
// Aggregate-input boundary (architecture-closure correction): this file
// NEVER receives or reads a raw expense record. Its only inputs are
// `monthlySeries` (an already-aggregated `{ monthKey, totalAmount }` array
// built by analytics/forecastInputAggregator.js from the analytics
// context/provider boundary) and `currentPartialMonthTotal` (an already-
// summed scalar). There is no line of code anywhere in this file that
// reads `_id`, `expenseName`, `expenseCategory`, `userId`, or an
// individual `expenseDate`/`expenseAmount` -- those fields simply have no
// meaning to any function here, so even a caller mistake that leaked a raw
// record into `monthlySeries` could not expose them (the entries are read
// only as `.monthKey`/`.totalAmount`; every other property is ignored).
//
// Scope boundary (mirrors expenseAnomalyAnalyzer.js): no database, Redis,
// filesystem, HTTP, ML-service, or provider calls, and never calls
// `new Date()` with zero arguments. The analysis anchor is the
// caller-supplied `currentMonthStart`, never discovered locally.
//
// Method: a Theil-Sen robust linear trend fitted to the trailing complete
// calendar months' totals (median of all pairwise slopes -- see
// `fitRobustTrend` below), with a median/MAD-derived uncertainty range
// computed from the trend line's residuals. See
// analytics/analyzers/scores/forecastRules.js for the full rationale for
// replacing the plain-median V1 approach. This is a transparent
// statistical estimate over the user's own historical totals, not a
// trained model; no accuracy figure is fabricated anywhere in this file.
"use strict";

const { forecast: RULES } = require("./scores/forecastRules");

const round2 = (value) => Number(Number(value).toFixed(2));

const median = (numbers) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const medianAbsoluteDeviation = (numbers, numbersMedian) => {
  const deviations = numbers.map((n) => Math.abs(n - numbersMedian));
  return median(deviations);
};

const parseAnchorDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// `analytics/forecastInputAggregator.js` produces `monthKey` strings in the
// exact form `${year}-${monthIndex}` (0-indexed month, LOCAL calendar
// fields -- e.g. "2026-2" is March 2026). This turns that string into a
// single monotonically-increasing integer ("calendar-month ordinal": year *
// 12 + monthIndex), which is what makes the gap between two non-adjacent
// months (e.g. January and March, skipping February) arithmetically
// visible: ordinal(March) - ordinal(January) = 2, not 1. Returns null for
// any string that doesn't match the expected shape -- callers must treat
// that as a malformed entry, never guess a position for it.
const MONTH_KEY_PATTERN = /^(-?\d+)-(\d+)$/;
function monthKeyToOrdinal(monthKey) {
  const match = typeof monthKey === "string" ? MONTH_KEY_PATTERN.exec(monthKey) : null;
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return null;
  return year * 12 + monthIndex;
}

// Same ordinal space as monthKeyToOrdinal(), computed directly from a Date
// -- used for the anchor month, which arrives as a Date, not a monthKey
// string.
function dateToOrdinal(date) {
  return date.getFullYear() * 12 + date.getMonth();
}

// Validates and normalizes `monthlySeries` entries without ever mutating
// the caller's array: only well-formed `{ monthKey: string, totalAmount:
// finite number }` entries whose `monthKey` parses into a real
// calendar-month ordinal survive; anything else (malformed shape,
// non-finite amount, an unparseable monthKey, a stray transaction-shaped
// object with no numeric `totalAmount`) is silently dropped, not thrown.
// Sorted by ordinal ascending regardless of input order (this is what
// makes the analyzer itself -- not just
// analytics/forecastInputAggregator.js's own bucket walk -- independent of
// the order `monthlySeries` arrives in). If two entries somehow resolve to
// the same ordinal (a caller bug -- forecastInputAggregator.js's own Map
// keying already guarantees this can't happen from a real expense pool),
// their totals are summed into one point rather than silently keeping only
// one of them, matching the "duplicate records within one month aggregate
// exactly once" requirement at this boundary too, defense in depth. Also
// defensively caps the accepted window to `RULES.maxHistoryMonths` points
// (the single centralized cap, shared with
// forecastInputAggregator.js, which already enforces it once).
function sanitizeMonthlySeries(monthlySeries) {
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
      continue; // e.g. Object.create(null) has no valueOf/toString -- skip, never throw
    }
    if (!Number.isFinite(amount)) continue;
    byOrdinal.set(ordinal, (byOrdinal.get(ordinal) ?? 0) + amount);
  }

  const points = [...byOrdinal.entries()]
    .map(([ordinal, total]) => ({ ordinal, total }))
    .sort((a, b) => a.ordinal - b.ordinal);

  return points.length > RULES.maxHistoryMonths
    ? points.slice(points.length - RULES.maxHistoryMonths)
    : points;
}

/**
 * Theil-Sen robust linear trend: fits `total ≈ intercept + slope * ordinal`
 * over `points` (`{ ordinal, total }`, sorted ascending by `ordinal` --
 * `ordinal` is the real calendar-month ordinal from
 * `monthKeyToOrdinal()`/`dateToOrdinal()` above, NEVER an array index).
 * This is the fix for a real calendar-gap defect: using array index as the
 * x-coordinate silently treats any two points as exactly one month apart
 * regardless of how many months actually separate them (e.g. January and
 * March, with February entirely missing, were previously fit as if
 * adjacent, computing a slope of (1400-1000)/1 = ₹400/month instead of the
 * true (1400-1000)/2 = ₹200/month). Using the real ordinal difference
 * (`points[j].ordinal - points[i].ordinal`, which is 2 for January->March)
 * makes the slope reflect the true elapsed calendar time between any two
 * points, gap or no gap.
 *
 * `slope` is the median of the slopes between every pair of points -- a
 * single outlier month can only ever be an endpoint of O(n) of the O(n^2)
 * pairs considered, so it cannot dominate the median the way it would
 * dominate a least-squares fit. `intercept` is the median of each point's
 * residual against `slope * ordinal`, the standard robust Theil-Sen
 * intercept estimator. `residualMad` is the median absolute deviation of
 * the fitted line's residuals, used as this forecast's uncertainty measure
 * in place of the raw totals' own spread.
 *
 * Degenerate cases (0 or 1 point) return a flat, zero-slope line rather
 * than throwing -- callers gate horizon computation on
 * `RULES.minHistoryMonthsFor*` (always >= 3) before this matters in
 * practice, but the function itself stays safe for any input length. Every
 * pair has a distinct ordinal by construction (sanitizeMonthlySeries()
 * above already merges same-ordinal entries before this function ever
 * runs), so no pairwise division by zero is possible here.
 */
function fitRobustTrend(points) {
  const n = points.length;

  if (n === 0) {
    return { slope: 0, intercept: 0, residualMad: 0 };
  }
  if (n === 1) {
    return { slope: 0, intercept: points[0].total, residualMad: 0 };
  }

  const slopes = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      slopes.push((points[j].total - points[i].total) / (points[j].ordinal - points[i].ordinal));
    }
  }
  const slope = median(slopes);

  const residualsAgainstSlope = points.map((point) => point.total - slope * point.ordinal);
  const intercept = median(residualsAgainstSlope);

  const residuals = points.map((point) => point.total - (intercept + slope * point.ordinal));
  const residualMedian = median(residuals);
  const residualMad = medianAbsoluteDeviation(residuals, residualMedian);

  return { slope, intercept, residualMad };
}

// Sum of the trend line's point estimates over `horizonMonths` consecutive
// future calendar months, starting at `anchorOrdinal` (the current,
// in-progress month's own ordinal -- see `analyze()` below: history is
// always strictly < the anchor month by construction, so `anchorOrdinal`
// is always exactly "the calendar month immediately after the latest
// possible completed month," whether or not the actual latest completed
// month in `points` has a gap right before the anchor). This replaces
// V1's "single monthly value * horizonMonths", which could not express a
// trend at all -- summing per-month trend projections means a rising
// trend produces a meaningfully larger quarter/year total than a flat
// trend at the same recent level, and a falling trend produces a smaller
// one. Not a seasonal model: each month's projection uses the same fitted
// slope, so within-year seasonal variation is not represented (documented
// limitation, not a hidden one).
function projectHorizonTotal(intercept, slope, anchorOrdinal, horizonMonths) {
  let total = 0;
  for (let h = 0; h < horizonMonths; h += 1) {
    total += intercept + slope * (anchorOrdinal + h);
  }
  return total;
}

// Builds one horizon's public result. `historyMonthsUsed`/`intercept`/
// `slope`/`residualMad`/`anchorOrdinal` are computed once by the caller
// and reused across all three horizons.
function buildHorizon({ horizonMonths, minHistoryMonths, reasonCode, historyMonthsUsed, anchorOrdinal, intercept, slope, residualMad }) {
  if (historyMonthsUsed < minHistoryMonths) {
    return {
      hasData: false,
      reasonCode,
      method: RULES.methodVersion,
      estimate: null,
      range: null,
      historyMonthsUsed,
      horizonMonths,
    };
  }

  const rawEstimate = projectHorizonTotal(intercept, slope, anchorOrdinal, horizonMonths);
  // Spending cannot be negative -- a strongly negative trend projection is
  // floored at zero before the range is built around it, so the range
  // invariant (0 <= lower <= estimate <= upper) always holds by
  // construction, including in a degenerate steep-decline case.
  const estimate = Math.max(0, rawEstimate);

  const spread = residualMad * RULES.madScaleConstant * horizonMonths;
  const lower = Math.max(RULES.minRangeLowerBound, estimate - spread);
  const upper = Math.max(lower, estimate + spread);

  return {
    hasData: true,
    reasonCode: null,
    method: RULES.methodVersion,
    estimate: round2(estimate),
    range: { lower: round2(lower), upper: round2(upper) },
    historyMonthsUsed,
    horizonMonths,
  };
}

/**
 * @param {object} input
 * @param {Array<{monthKey: string, totalAmount: number}>} input.monthlySeries -
 *   already-aggregated, bounded completed-month totals -- built by
 *   analytics/forecastInputAggregator.js, which always emits them
 *   chronologically. This function does not rely on that ordering, though:
 *   sanitizeMonthlySeries() re-sorts by each entry's real calendar-month
 *   ordinal (parsed from `monthKey`) regardless of input array order.
 *   Never a raw expense record array.
 * @param {number} input.currentPartialMonthTotal - the current, in-progress
 *   month's total so far, already summed by the caller. Never merged into
 *   history; only surfaced separately as `currentPartialMonth` so a caller
 *   can see it was explicitly excluded, not silently forgotten.
 * @param {Date} input.currentMonthStart - explicit, injectable anchor date,
 *   used only for validity checking here (the aggregation boundary already
 *   applied it when building `monthlySeries`). This function never calls
 *   `new Date()` to discover "now".
 */
const analyze = ({ monthlySeries = [], currentPartialMonthTotal = 0, currentMonthStart } = {}) => {
  const monthStart = parseAnchorDate(currentMonthStart);

  const partialTotal = Number(currentPartialMonthTotal);
  const safePartialTotal = Number.isFinite(partialTotal) ? round2(partialTotal) : 0;

  const currentPartialMonth = {
    included: false,
    totalSoFar: safePartialTotal,
    note: "The current, in-progress month is excluded from history and forecast estimates.",
  };

  const emptyHorizons = (anchorOrdinal = 0, intercept = 0, slope = 0, residualMad = 0, historyMonthsUsed = 0) => ({
    nextMonthForecast: buildHorizon({
      horizonMonths: 1,
      minHistoryMonths: RULES.minHistoryMonthsForNextMonth,
      reasonCode: RULES.reasonCodes.insufficientHistoryNextMonth,
      historyMonthsUsed,
      anchorOrdinal,
      intercept,
      slope,
      residualMad,
    }),
    nextQuarterForecast: buildHorizon({
      horizonMonths: 3,
      minHistoryMonths: RULES.minHistoryMonthsForNextQuarter,
      reasonCode: RULES.reasonCodes.insufficientHistoryNextQuarter,
      historyMonthsUsed,
      anchorOrdinal,
      intercept,
      slope,
      residualMad,
    }),
    nextYearForecast: buildHorizon({
      horizonMonths: 12,
      minHistoryMonths: RULES.minHistoryMonthsForNextYear,
      reasonCode: RULES.reasonCodes.insufficientHistoryNextYear,
      historyMonthsUsed,
      anchorOrdinal,
      intercept,
      slope,
      residualMad,
    }),
  });

  if (!monthStart) {
    return {
      hasData: false,
      method: RULES.methodVersion,
      historyMonthsAvailable: 0,
      currentPartialMonth,
      ...emptyHorizons(),
    };
  }

  // The future projection always starts at the anchor month's own real
  // calendar ordinal -- never "however many points happen to be in
  // history" -- so a gap anywhere in the history (including a gap
  // immediately before the anchor month) can never shift where the
  // forecast horizon begins. See projectHorizonTotal()'s doc comment
  // above for why this is also exactly "the calendar month immediately
  // after the latest possible completed month."
  const anchorOrdinal = dateToOrdinal(monthStart);

  const points = sanitizeMonthlySeries(monthlySeries);
  const historyMonthsUsed = points.length;

  const { slope, intercept, residualMad } = fitRobustTrend(points);

  const horizons = emptyHorizons(anchorOrdinal, intercept, slope, residualMad, historyMonthsUsed);

  return {
    hasData: horizons.nextMonthForecast.hasData,
    method: RULES.methodVersion,
    historyMonthsAvailable: historyMonthsUsed,
    // Explicit, separate representation of the current partial month --
    // never merged into history/estimates, per the requirement that any
    // partial-month use be explicit and justified. Included here purely as
    // an observational figure (what has been spent so far this month), not
    // as a forecast input.
    currentPartialMonth,
    ...horizons,
  };
};

module.exports = {
  analyze,
  // Exposed for direct, isolated unit testing of the trend math itself
  // (see tests/analytics.forecast.test.js's dedicated fitRobustTrend
  // assertions) -- not used by any other production module.
  fitRobustTrend,
};
