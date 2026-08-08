// Centralized, frozen V1 thresholds for riskAnalyzer.js. Same convention as
// expenseAnomalyRules.js / forecastRules.js -- nothing in the analyzer
// hardcodes a number that belongs here.
//
// V1 identifies a small, fixed set of CONCRETE signals from already-computed
// report sections (spending, budgets, trends, financialHealth, anomalies,
// forecast) -- it never queries raw collections and never lets the LLM
// invent a risk. Each signal has one reason code, one severity, and one
// evidence shape; there is no opaque aggregate score, no probabilistic
// language, and no investment/credit/medical-style advice anywhere in this
// module or its output.
"use strict";

const risk = {
  // -- BUDGET_ALREADY_OVERSPENT ----------------------------------------
  // No threshold needed -- sourced directly from budgets.isOverspent.

  // -- LOW_REMAINING_BUDGET --------------------------------------------
  // Utilization percentage (0-100) at or above which "low remaining
  // budget" is flagged -- but only when NOT already overspent, so the two
  // signals never double-count the same underlying condition.
  lowRemainingBudgetUtilizationPercent: 90,

  // -- PERSISTENT_SPENDING_GROWTH ---------------------------------------
  // Month-over-month percentage increase at or above which growth is
  // flagged as a risk signal.
  spendingGrowthPercent: 20,

  // -- FORECASTED_FINANCIAL_PRESSURE ------------------------------------
  // Ratio (forecasted next-month spend / configured budget) at or above
  // which forecasted pressure is flagged. 1.0 means the forecast alone
  // already meets or exceeds the whole configured budget.
  //
  // Explicit double-counting policy (architecture-closure audit item):
  // FORECASTED_FINANCIAL_PRESSURE and PERSISTENT_SPENDING_GROWTH are
  // deliberately allowed to co-occur. They are evaluated from different
  // report sections (forecast.nextMonthForecast vs
  // trends.monthlyTrend.percentageChange) and carry different evidence
  // (a forward-looking budget ratio vs a backward-looking percentage
  // change) -- they answer different questions ("will next month's
  // estimate exceed my budget" vs "has my spending been climbing"), so
  // both firing together for the same underlying upward trend is two
  // distinct, individually-true observations, not one condition counted
  // twice. This is the opposite case from BUDGET_ALREADY_OVERSPENT /
  // LOW_REMAINING_BUDGET below, which really would describe the exact
  // same condition twice and are therefore made mutually exclusive in
  // riskAnalyzer.js instead.
  forecastPressureRatio: 1.0,

  // -- DETERIORATING_HEALTH ----------------------------------------------
  // financialHealth.overall (0-100 scale, per healthAnalyzer.js) at or
  // below which health is flagged as deteriorating.
  deterioratingHealthScoreMax: 40,

  // -- ABNORMAL_HIGH_VALUE_EXPENSES ---------------------------------------
  // Anomaly severities (from expenseAnomalyRules.js's own severityTiers)
  // that count as risk-relevant evidence -- "moderate" anomalies alone do
  // not rise to a risk signal, only "high"/"very_high" do.
  anomalySeveritiesConsideredRisky: ["high", "very_high"],
  // At most this many anomaly records are surfaced as evidence, even if
  // more qualify -- bounded public evidence, same convention as
  // expenseAnomalyRules.js's maxAnomalies.
  maxAnomalyEvidenceCount: 5,

  // Severity vocabulary, defined exactly once, reused by every signal and
  // by the overall risk level. No "severe"/"critical"/"extreme" -- same
  // restraint expenseAnomalyRules.js already established.
  severityLevels: ["low", "moderate", "high"],
  // A signal's own fixed severity (not calculated from a formula -- each
  // signal's real-world stakes are assigned once, here, by a person, not
  // derived).
  signalSeverity: {
    BUDGET_ALREADY_OVERSPENT: "high",
    LOW_REMAINING_BUDGET: "moderate",
    PERSISTENT_SPENDING_GROWTH: "moderate",
    ABNORMAL_HIGH_VALUE_EXPENSES: "moderate",
    FORECASTED_FINANCIAL_PRESSURE: "high",
    DETERIORATING_HEALTH: "high",
  },

  maxSignals: 10,

  noDataReasonCode: "NO_REPORT_DATA",
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

module.exports = deepFreeze({ risk });
