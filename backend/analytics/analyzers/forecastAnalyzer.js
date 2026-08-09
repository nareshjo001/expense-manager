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
// Prediction Layer V1: the trend math moved to ./robustTrend.js unchanged
// (same formulas, same constants) so the per-category breakdown can use the
// literal same function. This module still re-exports fitRobustTrend below,
// so every existing importer and test is unaffected.
const { fitRobustTrend } = require("./robustTrend");
const categoryForecastAllocator = require("./categoryForecastAllocator");
const forecastBudgetRisk = require("./forecastBudgetRisk");

const round2 = (value) => Number(Number(value).toFixed(2));

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

// `fitRobustTrend` now lives in ./robustTrend.js (imported above and
// re-exported at the bottom of this module). See that file for the full
// Theil-Sen rationale, the calendar-gap correctness note, and the
// degenerate-input behavior -- the implementation itself is unchanged.

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

// Prediction Layer V1 (corrected): the forecast's TARGET month is the NEXT
// calendar month relative to the caller-supplied anchor (the current,
// in-progress month) -- never the anchor month itself.
//
// Why this is a real distinction, not a rename: the LEGACY
// `nextMonthForecast` horizon has always projected at the ANCHOR ordinal,
// i.e. the current, in-progress month, computed from completed-month
// history. That committed v3 behavior is preserved byte-for-byte below.
// Prediction Layer V1 promises a genuinely NEXT-calendar-month figure, so
// it is computed separately at anchorOrdinal + 1 and published under its
// own field. The two are observably different whenever the trend is not
// flat.
//
// Uses Date arithmetic (month + 1) rather than string maths so December ->
// January year rollover is handled by the platform: new Date(2026, 11+1, 1)
// is January 2027.
function nextCalendarMonthOf(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

// Stable "YYYY-MM" label for a given month-start Date. Never calls
// `new Date()` to discover "now".
function formatMonthKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

// Prediction Layer V1: a purely DESCRIPTIVE summary of the history behind
// the estimates. It never gates or alters any forecast value -- the
// per-horizon minHistoryMonthsFor* rules remain the only gates -- and never
// states an accuracy figure, because none is measured anywhere in this
// feature.
function buildDataQuality({ completedMonths, activeDays, points }) {
  const { statuses, warnings: WARN, sufficientCompletedMonths } = RULES.dataQuality;
  const warnings = [];

  if (completedMonths > 0 && completedMonths < sufficientCompletedMonths) {
    warnings.push(WARN.limitedHistory);
  }

  // A calendar gap means the observed months are not contiguous, which the
  // straight-line trend does not model. Surfaced as an explicit warning
  // rather than silently affecting the estimate.
  if (Array.isArray(points) && points.length >= 2) {
    const span = points[points.length - 1].ordinal - points[0].ordinal + 1;
    if (span > points.length) warnings.push(WARN.historyGaps);
  }

  return {
    status: completedMonths >= sufficientCompletedMonths ? statuses.sufficient : statuses.limited,
    completedMonths,
    activeDays,
    method: RULES.methodVersion,
    warnings,
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
 * @param {Array<{category: string, monthlySeries: Array}>} [input.categorySeries] -
 *   Prediction Layer V1: aggregate-only per-category history from
 *   analytics/forecastInputAggregator.js. Optional -- omitting it simply
 *   yields no category breakdown, never an error, so every pre-existing
 *   caller keeps working unchanged.
 * @param {number} [input.activeDays] - Prediction Layer V1: descriptive
 *   count of distinct days with recorded activity in the history window.
 * @param {{budget?: number}|null} [input.targetMonthBudget] - Prediction
 *   Layer V1: the budget the user has explicitly created for the FORECAST
 *   TARGET month (never the current month's budget). Null/absent yields a
 *   `no_budget` risk status rather than a substituted comparison.
 */
const analyze = ({
  monthlySeries = [],
  currentPartialMonthTotal = 0,
  currentMonthStart,
  categorySeries = [],
  activeDays = 0,
  targetMonthBudget = null,
} = {}) => {
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

  const safeActiveDays = Number.isFinite(Number(activeDays)) ? Math.max(0, Math.trunc(Number(activeDays))) : 0;

  if (!monthStart) {
    return {
      hasData: false,
      method: RULES.methodVersion,
      historyMonthsAvailable: 0,
      currentPartialMonth,
      targetMonth: null,
      dataQuality: buildDataQuality({ completedMonths: 0, activeDays: safeActiveDays, points: [] }),
      nextCalendarMonthForecast: {
        ...buildHorizon({
          horizonMonths: 1,
          minHistoryMonths: RULES.minHistoryMonthsForNextMonth,
          reasonCode: RULES.reasonCodes.insufficientHistoryNextMonth,
          historyMonthsUsed: 0,
          anchorOrdinal: 0,
          intercept: 0,
          slope: 0,
          residualMad: 0,
        }),
        targetMonth: null,
        categories: [],
        categoriesReasonCode: RULES.reasonCodes.noCategoryBreakdown,
      },
      budgetRisk: forecastBudgetRisk.evaluate({ predictedTotal: null, targetMonthBudget }),
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

  // LEGACY horizons -- byte-for-byte the committed v3 behavior, projected
  // at the ANCHOR ordinal (the current, in-progress month). Deliberately
  // left completely untouched, including `nextMonthForecast`'s historically
  // misleading name: existing consumers and the committed contract depend
  // on these exact values.
  const horizons = emptyHorizons(anchorOrdinal, intercept, slope, residualMad, historyMonthsUsed);

  // Prediction Layer V1 (corrected): the TRUE next-calendar-month forecast,
  // evaluated at anchorOrdinal + 1 -- one full calendar month beyond the
  // legacy horizon. Same fitted trend, same MAD-derived spread, same
  // history gate, same non-negative flooring and the same reason code, so
  // nothing about the proven engine changes; only the ordinal it is
  // evaluated at differs. The current partial month is still never fitted
  // (it was excluded at the aggregation boundary), so targeting a farther
  // month cannot leak current-month spending into the estimate.
  const nextCalendarMonthStart = nextCalendarMonthOf(monthStart);
  const nextCalendarOrdinal = anchorOrdinal + 1;

  const nextCalendarMonthForecast = buildHorizon({
    horizonMonths: 1,
    minHistoryMonths: RULES.minHistoryMonthsForNextMonth,
    reasonCode: RULES.reasonCodes.insufficientHistoryNextMonth,
    historyMonthsUsed,
    anchorOrdinal: nextCalendarOrdinal,
    intercept,
    slope,
    residualMad,
  });

  // The per-category breakdown reconciles to the TRUE next-calendar-month
  // estimate (never the legacy current-month projection) and is projected
  // at the same true target ordinal.
  const categoryBreakdown = nextCalendarMonthForecast.hasData
    ? categoryForecastAllocator.allocate({
        categorySeries,
        predictedTotal: nextCalendarMonthForecast.estimate,
        anchorOrdinal: nextCalendarOrdinal,
      })
    : { hasData: false, reasonCode: RULES.reasonCodes.noCategoryBreakdown, categories: [] };

  return {
    hasData: horizons.nextMonthForecast.hasData,
    method: RULES.methodVersion,
    historyMonthsAvailable: historyMonthsUsed,
    // The NEXT calendar month -- what nextCalendarMonthForecast targets.
    // Never the anchor/current month.
    targetMonth: formatMonthKey(nextCalendarMonthStart),
    dataQuality: buildDataQuality({
      completedMonths: historyMonthsUsed,
      activeDays: safeActiveDays,
      points,
    }),
    nextCalendarMonthForecast: {
      ...nextCalendarMonthForecast,
      targetMonth: formatMonthKey(nextCalendarMonthStart),
      categories: categoryBreakdown.categories,
      categoriesReasonCode: categoryBreakdown.hasData ? null : categoryBreakdown.reasonCode,
    },
    // Forecast-vs-budget interpretation for the TRUE target month only.
    // Reuses budgetAnalyzer.js's own exported thresholds (see
    // analyzers/forecastBudgetRisk.js) rather than restating them, and
    // reports `no_budget` when the user has not created a budget for that
    // specific month -- no other month's budget is ever substituted.
    budgetRisk: forecastBudgetRisk.evaluate({
      predictedTotal: nextCalendarMonthForecast.hasData ? nextCalendarMonthForecast.estimate : null,
      targetMonthBudget,
    }),
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
