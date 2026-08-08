// Centralized, frozen V2 thresholds for forecastAnalyzer.js. Same
// convention as expenseAnomalyRules.js -- nothing in the analyzer
// hardcodes a number that belongs here.
//
// V2 method (architecture-closure correction over V1): a Theil-Sen robust
// linear trend fitted to the trailing complete calendar months' totals,
// with a median/MAD-derived range (computed from the trend line's
// residuals, not the raw totals) as the uncertainty band.
//
// Why this replaced the plain-median V1 approach: a plain trailing median
// has NO directional component at all -- a steadily rising spending
// history and a flat history at the same average level produce an
// IDENTICAL forecast, which is not an honest "estimate of what happens
// next". Theil-Sen (the median of the slopes between every pair of
// historical monthly points) was chosen specifically because it adds a
// real trend signal while remaining exactly as outlier-resistant as the
// median it replaces: one anomalous month can only ever be one endpoint of
// O(n) of the O(n^2) pairwise slopes, so it cannot dominate their median,
// the same guarantee the V1 approach relied on for the level estimate.
// This is still a small, fully-explainable formula (see
// forecastAnalyzer.js's `fitRobustTrend` for the exact arithmetic) -- not
// linear regression (which minimizes squared error and is outlier-
// sensitive), not exponential smoothing, and not a trained model. No
// dataset, training run, or accuracy score exists for this feature -- this
// is explicitly a statistical estimate, not "AI" or "machine learning",
// and must never be described as either. Seasonality is deliberately NOT
// modeled -- the trend line assumes the recent linear trend continues
// unchanged over the forecast horizon, which is a documented limitation,
// not a hidden one.
"use strict";

const forecast = {
  // How many trailing COMPLETE calendar months (never the current,
  // in-progress month) are pulled into the history window before any
  // horizon-specific minimum is checked.
  maxHistoryMonths: 12,

  // A horizon is only computed once at least this many complete months of
  // history exist. Below this, the horizon's `hasData` is false and a
  // reason code is returned instead of a guessed number.
  minHistoryMonthsForNextMonth: 3,
  minHistoryMonthsForNextQuarter: 3,
  // Extrapolating a full year from a handful of months is exactly the
  // "populate a field regardless of adequacy" failure this feature must
  // avoid -- a materially higher bar is required.
  minHistoryMonthsForNextYear: 6,

  // 0.6745 is the same standard modified-z constant expenseAnomalyRules.js
  // documents -- used here only to scale MAD into a comparable spread
  // measure for the uncertainty range, not for any flagging decision.
  madScaleConstant: 1.4826,

  // The uncertainty range's lower bound is never allowed to go negative --
  // spending cannot be negative, so a range that would dip below zero is
  // clamped at zero instead of implying refunds are expected.
  minRangeLowerBound: 0,

  reasonCodes: {
    insufficientHistoryNextMonth: "INSUFFICIENT_HISTORY_FOR_NEXT_MONTH",
    insufficientHistoryNextQuarter: "INSUFFICIENT_HISTORY_FOR_NEXT_QUARTER",
    insufficientHistoryNextYear: "INSUFFICIENT_HISTORY_FOR_NEXT_YEAR",
  },

  methodVersion: "ROBUST_TREND_MEDIAN_V2",

  // Horizon-level uncertainty spread is scaled LINEARLY by horizonMonths
  // (spreadPerMonth * horizonMonths), not by sqrt(horizonMonths) as a
  // pure independent-errors model would suggest. This is a deliberate,
  // conservative (wider, safer) simplification -- linear scaling never
  // understates uncertainty relative to the sqrt-scaled alternative, and a
  // wider stated range is the honest choice when month-to-month errors are
  // not actually known to be independent.
};

const deepFreeze = (value) => {
  Object.freeze(value);
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      const child = value[key];
      if (child && typeof child === "object" && !Object.isFrozen(child)) {
        deepFreeze(child);
      }
    }
  }
  return value;
};

module.exports = deepFreeze({ forecast });
