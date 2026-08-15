// A pure, deterministic, explicitly-statistical (not "AI", not machine-learned) spending forecast analyzer. Aggregate-input boundary: only reads already-aggregated `monthlySeries`/`currentPartialMonthTotal`, never a raw expense record or any individual transaction field. No database/Redis/filesystem/HTTP/ML-service calls; the anchor is always the caller-supplied `currentMonthStart`, never discovered locally. Method: a Theil-Sen robust linear trend over trailing complete calendar months (see `fitRobustTrend` below), with a median/MAD-derived uncertainty range from the residuals -- a transparent statistical estimate over the user's own history, never a trained model or fabricated accuracy figure.
"use strict";

const { forecast: RULES } = require("./scores/forecastRules");
// Trend math lives in ./robustTrend.js (re-exported below) so the per-category breakdown can use the literal same function; every existing importer/test is unaffected.
const { fitRobustTrend } = require("./robustTrend");
const categoryForecastAllocator = require("./categoryForecastAllocator");
const forecastBudgetRisk = require("./forecastBudgetRisk");

const round2 = (value) => Number(Number(value).toFixed(2));

const parseAnchorDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Turns forecastInputAggregator.js's "${year}-${monthIndex}" monthKey (0-indexed, local calendar) into a monotonically-increasing calendar-month ordinal (year*12+monthIndex), making a gap between non-adjacent months arithmetically visible. Returns null for a malformed string -- callers must treat that as invalid, never guess a position.
const MONTH_KEY_PATTERN = /^(-?\d+)-(\d+)$/;
function monthKeyToOrdinal(monthKey) {
  const match = typeof monthKey === "string" ? MONTH_KEY_PATTERN.exec(monthKey) : null;
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return null;
  return year * 12 + monthIndex;
}

// Same ordinal space as monthKeyToOrdinal(), computed directly from a Date -- used for the anchor month, which arrives as a Date, not a monthKey string.
function dateToOrdinal(date) {
  return date.getFullYear() * 12 + date.getMonth();
}

// Validates and normalizes `monthlySeries` without mutating the caller's array -- malformed entries are silently dropped, never thrown. Sorted by ordinal ascending regardless of input order (making this analyzer, not just the aggregator's bucket walk, independent of input order); duplicate ordinals are summed as defense in depth. Also caps to `RULES.maxHistoryMonths` points, the same centralized cap forecastInputAggregator.js enforces.
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

// fitRobustTrend now lives in ./robustTrend.js (re-exported below); see that file for the Theil-Sen rationale, calendar-gap note, and degenerate-input behavior.

// Sum of the trend line's point estimates over `horizonMonths` consecutive future months from `anchorOrdinal`. Replaces V1's "single monthly value * horizonMonths", which couldn't express a trend: summing per-month projections means a rising/falling trend produces a meaningfully larger/smaller total, not a flat multiple. Not seasonal -- each month uses the same fitted slope (a documented limitation, not a hidden one).
function projectHorizonTotal(intercept, slope, anchorOrdinal, horizonMonths) {
  let total = 0;
  for (let h = 0; h < horizonMonths; h += 1) {
    total += intercept + slope * (anchorOrdinal + h);
  }
  return total;
}

// Builds one horizon's public result. historyMonthsUsed/intercept/slope/residualMad/anchorOrdinal are computed once by the caller and reused across all three horizons.
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
  // Spending cannot be negative -- floored at zero before the range is built around it, so 0 <= lower <= estimate <= upper always holds, even in a steep-decline case.
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

// The forecast's target month is the NEXT calendar month relative to the anchor -- never the anchor month itself. This is a real distinction from the legacy `nextMonthForecast` horizon, which has always projected at the anchor ordinal (preserved byte-for-byte below); the two are observably different whenever the trend isn't flat. Uses Date arithmetic (month + 1) so December -> January year rollover is handled by the platform.
function nextCalendarMonthOf(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

// Stable "YYYY-MM" label for a month-start Date. Never calls `new Date()` to discover "now".
function formatMonthKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

// A purely descriptive summary of the history behind the estimates -- never gates or alters any forecast value (the per-horizon minHistoryMonthsFor* rules are the only gates), and never states an accuracy figure since none is measured.
function buildDataQuality({ completedMonths, activeDays, points }) {
  const { statuses, warnings: WARN, sufficientCompletedMonths } = RULES.dataQuality;
  const warnings = [];

  if (completedMonths > 0 && completedMonths < sufficientCompletedMonths) {
    warnings.push(WARN.limitedHistory);
  }

  // A calendar gap means the observed months aren't contiguous, which the straight-line trend doesn't model -- surfaced as an explicit warning rather than silently affecting the estimate.
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
 *   already-aggregated, bounded completed-month totals, re-sorted by real calendar-month
 *   ordinal regardless of input order. Never a raw expense record array.
 * @param {number} input.currentPartialMonthTotal - the current in-progress month's total so far; never merged into history, only surfaced separately as `currentPartialMonth`.
 * @param {Date} input.currentMonthStart - explicit, injectable anchor date. Never discovers "now" via `new Date()`.
 * @param {Array<{category: string, monthlySeries: Array}>} [input.categorySeries] -
 *   aggregate-only per-category history. Optional -- omitting it yields no category breakdown, never an error.
 * @param {number} [input.activeDays] - descriptive count of distinct days with recorded activity.
 * @param {{budget?: number}|null} [input.targetMonthBudget] - the budget for the forecast TARGET month (never the current month's). Null yields `no_budget`, never a substituted comparison.
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

  // The future projection always starts at the anchor month's own real calendar ordinal, never "however many points happen to be in history" -- so a gap anywhere in the history can never shift where the forecast horizon begins.
  const anchorOrdinal = dateToOrdinal(monthStart);

  const points = sanitizeMonthlySeries(monthlySeries);
  const historyMonthsUsed = points.length;

  const { slope, intercept, residualMad } = fitRobustTrend(points);

  // Legacy horizons -- byte-for-byte the committed v3 behavior, projected at the anchor ordinal (the current, in-progress month). Deliberately untouched, including `nextMonthForecast`'s historically misleading name -- existing consumers depend on these exact values.
  const horizons = emptyHorizons(anchorOrdinal, intercept, slope, residualMad, historyMonthsUsed);

  // The true next-calendar-month forecast, evaluated at anchorOrdinal + 1 -- one month beyond the legacy horizon, same engine (trend, spread, gate, flooring, reason code), only the target ordinal differs.
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

  // Reconciles to the true next-calendar-month estimate (never the legacy current-month projection), projected at the same target ordinal.
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
    // The next calendar month -- what nextCalendarMonthForecast targets, never the anchor/current month.
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
    // Forecast-vs-budget interpretation for the true target month only, reusing forecastBudgetRisk.js's own thresholds; reports `no_budget` when the user hasn't created a budget for that specific month -- no other month's budget is ever substituted.
    budgetRisk: forecastBudgetRisk.evaluate({
      predictedTotal: nextCalendarMonthForecast.hasData ? nextCalendarMonthForecast.estimate : null,
      targetMonthBudget,
    }),
    // Explicit, separate representation of the current partial month -- never merged into history/estimates; purely observational, not a forecast input.
    currentPartialMonth,
    ...horizons,
  };
};

module.exports = {
  analyze,
  // Exposed for direct unit testing of the trend math (see tests/analytics.forecast.test.js) -- not used by any other production module.
  fitRobustTrend,
};
