// Centralized, frozen V2 thresholds for forecastAnalyzer.js -- same convention as expenseAnomalyRules.js, nothing in the analyzer hardcodes a number that belongs here. V2 method: a Theil-Sen robust linear trend fitted to trailing complete calendar months' totals, with a median/MAD-derived range (from the trend line's residuals, not raw totals) as the uncertainty band -- replaces the plain-median V1 approach, which had no directional component (a rising history and a flat history at the same average produced an identical forecast). Theil-Sen (median of the slopes between every pair of historical points) adds a real trend signal while staying exactly as outlier-resistant as the median it replaces (one anomalous month can only be one endpoint of O(n) of the O(n^2) pairwise slopes). Still a small, fully-explainable formula (see forecastAnalyzer.js's `fitRobustTrend`) -- not linear regression, not exponential smoothing, not a trained model; no dataset/training run/accuracy score exists, so this must never be described as "AI" or "machine learning". Seasonality is deliberately NOT modeled -- a documented, not hidden, limitation.
"use strict";

const forecast = {
  // How many trailing COMPLETE calendar months (never the current, in-progress month) are pulled into the history window before any horizon-specific minimum is checked.
  maxHistoryMonths: 12,

  // A horizon is only computed once at least this many complete months of history exist -- below this, `hasData` is false and a reason code is returned instead of a guessed number.
  minHistoryMonthsForNextMonth: 3,
  minHistoryMonthsForNextQuarter: 3,
  // Extrapolating a full year from a handful of months is exactly the "populate a field regardless of adequacy" failure this feature must avoid -- a materially higher bar is required.
  minHistoryMonthsForNextYear: 6,

  // Same standard modified-z constant expenseAnomalyRules.js documents -- used here only to scale MAD into a comparable spread measure for the uncertainty range, not for any flagging decision.
  madScaleConstant: 1.4826,

  // The uncertainty range's lower bound is never allowed to go negative -- spending can't be negative, so a range dipping below zero is clamped at zero instead of implying refunds are expected.
  minRangeLowerBound: 0,

  reasonCodes: {
    insufficientHistoryNextMonth: "INSUFFICIENT_HISTORY_FOR_NEXT_MONTH",
    insufficientHistoryNextQuarter: "INSUFFICIENT_HISTORY_FOR_NEXT_QUARTER",
    insufficientHistoryNextYear: "INSUFFICIENT_HISTORY_FOR_NEXT_YEAR",
    // The overall next-month estimate exists but no category-level breakdown could be produced (e.g. every category series was empty, or every raw prediction and historical share was zero).
    noCategoryBreakdown: "NO_CATEGORY_BREAKDOWN_AVAILABLE",
  },

  methodVersion: "ROBUST_TREND_MEDIAN_V2",

  // Current-month nowcast. The point estimate always starts with every
  // expense already logged this month; these rules only control how much
  // historical/current spending is allowed to influence the estimate for
  // the days that remain. An automatically detected one-off is capped at
  // the robust upper boundary rather than deleted, protecting legitimate
  // but rare costs from disappearing completely.
  currentMonth: {
    methodVersion: "CURRENT_MONTH_ROBUST_NOWCAST_V1",
    minHistoryMonths: 3,
    minCategoryBaselineRecords: 5,
    minOverallBaselineRecords: 8,
    maxHistoricalMonthsForRareName: 1,
    minMonthlyMaterialityRatio: 0.15,
    minPaceWeight: 0.15,
    maxPaceWeight: 0.85,
    reasonCodes: {
      insufficientHistory: "INSUFFICIENT_HISTORY_FOR_CURRENT_MONTH",
      rareHighValueExpense: "RARE_HIGH_VALUE_EXPENSE",
    },
  },

  // --- category-level breakdown -------------------
  //
  // Each category is forecast from its OWN monthly history using exactly the same Theil-Sen `fitRobustTrend` function the overall forecast uses (not a second, divergent method), then every category prediction is reconciled so rounded category amounts sum EXACTLY to the already-published overall estimate. Categories are always discovered dynamically from the user's own data.
  category: {
    // A category needs at least this many ALIGNED months on the canonical completed-month timeline (buildCompletedMonthCategorySeries) before its own trend is fitted -- since every category is zero-filled against that timeline, this is effectively a check on overall history depth.
    minMonthsForOwnTrend: 3,

    // ...and at least this many months with ACTUAL (non-zero) spending -- an absolute floor, so a category seen once is never "trended" across a row of zeros.
    minNonZeroMonthsForOwnTrend: 2,

    // ...and present in at least this FRACTION of the aligned timeline -- deliberately a ratio, not a raw count: a category in 3 of 12 aligned months is intermittent regardless of the absolute number. Routing it to its own Theil-Sen trend would produce a median-based estimate of exactly 0 (most aligned months are zero), silently hiding a genuinely recurring cost -- intermittent categories use the smoothed-share fallback instead.
    minNonZeroRatioForOwnTrend: 0.5,

    // How many trailing observed months the sparse-category share fallback averages over -- smoothing stops a single unusual month from dominating an intermittent category's allocation.
    shareSmoothingMonths: 3,

    // Per-category method labels surfaced in the public contract, so a reader can tell which categories carry their own fitted trend vs. were allocated by share.
    methods: {
      ownTrend: "CATEGORY_ROBUST_TREND",
      smoothedShare: "CATEGORY_SMOOTHED_SHARE",
    },
  },

  // --- data-quality summary ------------------------
  //
  // Purely descriptive: reports what history actually exists, never gates or alters any estimate (the per-horizon minHistoryMonthsFor* rules remain the only gates). `sufficient` deliberately uses the same 6-month bar as minHistoryMonthsForNextYear, so "sufficient" never claims more confidence than the horizon gates themselves do.
  dataQuality: {
    sufficientCompletedMonths: 6,
    statuses: {
      limited: "limited",
      sufficient: "sufficient",
    },
    warnings: {
      // Emitted when observed months in the window aren't calendar-contiguous, since the trend line assumes evenly-spaced months.
      historyGaps: "HISTORY_HAS_CALENDAR_GAPS",
      // Emitted when history exists but is below the "sufficient" bar.
      limitedHistory: "LIMITED_HISTORY",
    },
  },

  // --- forecast-vs-budget risk ---------------------
  //
  // Deliberately NOT a second set of budget thresholds: numeric tier boundaries are imported at use time from budgetAnalyzer.js's own STATUS_THRESHOLDS (forecastBudgetRisk.js), so this module never restates them and the two can't silently drift -- only the forecast-specific status *names* live here.
  // The target-month budget lookup is exact-match only: this repository's budget model is keyed per calendar month with no recurring/reusable concept, so a next-month budget exists ONLY if the user already created one for that exact month; when none exists the status is `no_budget` -- the current month's budget is never substituted.
  budgetRisk: {
    statuses: {
      safe: "safe",
      watch: "watch",
      high: "high",
      noBudget: "no_budget",
      insufficientData: "insufficient_data",
    },
  },

  // Horizon-level uncertainty spread is scaled LINEARLY by horizonMonths (spreadPerMonth * horizonMonths), not sqrt(horizonMonths) as a pure independent-errors model would suggest -- a deliberate, conservative simplification: linear scaling never understates uncertainty, and a wider range is the honest choice when month-to-month errors aren't known to be independent.
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
