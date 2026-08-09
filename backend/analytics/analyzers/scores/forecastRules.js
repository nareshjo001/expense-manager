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
    // Prediction Layer V1: the overall next-month estimate exists but no
    // category-level breakdown could be produced from it (e.g. every
    // category series was empty, or every raw category prediction and every
    // historical share was zero, so there is nothing honest to allocate).
    noCategoryBreakdown: "NO_CATEGORY_BREAKDOWN_AVAILABLE",
  },

  methodVersion: "ROBUST_TREND_MEDIAN_V2",

  // --- Prediction Layer V1: category-level breakdown -------------------
  //
  // Each category is forecast from its OWN monthly history using exactly
  // the same Theil-Sen robust trend the overall forecast uses (literally
  // the same `fitRobustTrend` function -- not a second, divergent method),
  // then every category prediction is reconciled so the rounded category
  // amounts sum EXACTLY to the already-published overall next-month
  // estimate. Categories are always discovered dynamically from the user's
  // own data; nothing here assumes a fixed category list or count.
  category: {
    // A category needs at least this many ALIGNED months on the canonical
    // completed-month timeline (see forecastInputAggregator.js's
    // buildCompletedMonthCategorySeries) before its own trend is fitted.
    // Since every category is zero-filled against that one timeline, this
    // is effectively a check on how much history exists overall.
    minMonthsForOwnTrend: 3,

    // ...and at least this many months with ACTUAL (non-zero) spending in
    // that category -- an absolute floor, so a category seen exactly once
    // is never "trended" across a row of zeros.
    minNonZeroMonthsForOwnTrend: 2,

    // ...and present in at least this FRACTION of the aligned timeline.
    //
    // This is what distinguishes a regular category from an intermittent
    // one, and it is deliberately a ratio rather than a raw count: a
    // category seen in 3 of 12 aligned months is intermittent regardless of
    // the absolute number 3. Routing it to its own Theil-Sen trend would
    // produce a MEDIAN-based estimate of exactly 0 (9 of its 12 aligned
    // months are zero, so both the median slope and the median residual are
    // 0), which would silently hide a genuinely recurring cost. Intermittent
    // categories therefore use the smoothed-share fallback, which is exactly
    // what that fallback exists for.
    minNonZeroRatioForOwnTrend: 0.5,

    // How many trailing observed months the sparse-category share fallback
    // averages over. Smoothing (rather than using only the most recent
    // month's share) stops a single unusual month from dominating an
    // intermittent category's allocation.
    shareSmoothingMonths: 3,

    // Per-category method labels surfaced in the public contract, so a
    // reader can always tell which categories carry their own fitted trend
    // and which were allocated by share.
    methods: {
      ownTrend: "CATEGORY_ROBUST_TREND",
      smoothedShare: "CATEGORY_SMOOTHED_SHARE",
    },
  },

  // --- Prediction Layer V1: data-quality summary ------------------------
  //
  // Purely descriptive: it reports what history actually exists, and never
  // gates or alters any estimate (the per-horizon minHistoryMonthsFor*
  // rules above remain the only gates). `sufficient` deliberately uses the
  // same 6-month bar as minHistoryMonthsForNextYear -- the point at which
  // this feature is willing to extrapolate a full year -- so "sufficient"
  // never claims more confidence than the horizon gates themselves do.
  dataQuality: {
    sufficientCompletedMonths: 6,
    statuses: {
      limited: "limited",
      sufficient: "sufficient",
    },
    warnings: {
      // Emitted when the observed months in the window are not calendar-
      // contiguous, since the trend line assumes evenly-spaced months.
      historyGaps: "HISTORY_HAS_CALENDAR_GAPS",
      // Emitted when history exists but is below the "sufficient" bar.
      limitedHistory: "LIMITED_HISTORY",
    },
  },

  // --- Prediction Layer V1: forecast-vs-budget risk ---------------------
  //
  // Deliberately NOT a second set of budget thresholds: the numeric tier
  // boundaries are imported at use time from budgetAnalyzer.js's own
  // exported STATUS_THRESHOLDS (see analyzers/forecastBudgetRisk.js), so
  // this module never restates them and the two can never silently drift.
  // Only the *names* of the forecast-specific statuses live here.
  //
  // The target-month budget lookup is exact-match only. This repository's
  // budget model (config/Schemas.js budgetSchema) is keyed per calendar
  // month (`{ userId, month: "Sep 2026", budget, spent }`) and has no
  // recurring/reusable monthly-budget concept whatsoever, so a next-month
  // budget exists ONLY if the user has already created one for that exact
  // month. When none exists the status is `no_budget` -- the current
  // month's budget is never substituted for the forecast target month.
  budgetRisk: {
    statuses: {
      safe: "safe",
      watch: "watch",
      high: "high",
      noBudget: "no_budget",
      insufficientData: "insufficient_data",
    },
  },

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
