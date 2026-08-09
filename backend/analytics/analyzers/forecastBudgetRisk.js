// Prediction Layer V1: forecast-vs-budget risk interpretation.
//
// Answers exactly one question: "is the predicted next-month spend likely
// to exceed the budget that actually exists for that month?" -- and says
// `no_budget` rather than guessing whenever no such budget exists.
//
// Deliberately NOT a second budget calculator. It does not compute
// utilization for the CURRENT month (budgetAnalyzer.js owns that), does not
// re-derive any health/risk score (healthAnalyzer.js / riskAnalyzer.js own
// those), and does not restate budgetAnalyzer.js's tier boundaries -- it
// imports that module's own exported STATUS_THRESHOLDS and collapses them
// onto this feature's three forecast statuses, so the two can never drift.
//
// Target-month budget semantics (important, and deliberately strict): this
// repository's budget model (config/Schemas.js `budgetSchema`) is keyed per
// calendar month -- `{ userId, month: "Sep 2026", budget, spent }` -- and
// has NO recurring/reusable monthly-budget concept. A budget for the
// forecast's target month therefore exists only if the user has already
// created that exact month's budget document. The current month's budget is
// never reused as a stand-in for next month's; doing so would silently
// invent a budget the user never set.
//
// Pure and deterministic: no DB/Redis/HTTP access, no zero-argument
// `new Date()`, no mutation of its inputs.
"use strict";

const { forecast: RULES } = require("./scores/forecastRules");
const { STATUS_THRESHOLDS } = require("./budgetAnalyzer");

const round2 = (value) => Number(Number(value).toFixed(2));

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

// budgetAnalyzer.js's tiers are ascending `{ max, status }` pairs:
//   Safe (<=70) | Warning (<=90) | Critical (<=100) | Overspent (>100).
// This feature reports three actionable forecast statuses, so Critical and
// Overspent both collapse into `high` -- both mean "the prediction does not
// comfortably fit inside the budget". The NUMBERS are never restated here;
// they are read from the imported thresholds at call time, so changing a
// boundary in budgetAnalyzer.js automatically changes this mapping too.
const FORECAST_STATUS_BY_BUDGET_STATUS = Object.freeze({
  Safe: RULES.budgetRisk.statuses.safe,
  Warning: RULES.budgetRisk.statuses.watch,
  Critical: RULES.budgetRisk.statuses.high,
  Overspent: RULES.budgetRisk.statuses.high,
});

// Mirrors budgetAnalyzer.js's own tier walk exactly (first tier whose `max`
// the utilization falls under wins), against the same imported table.
function budgetStatusForUtilization(utilization) {
  const tier = STATUS_THRESHOLDS.find((candidate) => utilization <= candidate.max);
  return tier ? tier.status : null;
}

/**
 * @param {object} input
 * @param {number|null} input.predictedTotal - the already-published
 *   next-month point estimate. Null/non-finite means the forecast horizon
 *   itself was unavailable.
 * @param {{budget?: number}|null} input.targetMonthBudget - the budget
 *   document (or plain entry) for the forecast's TARGET month only, already
 *   looked up by the caller from the existing budget history. Null when the
 *   user has not created one for that month.
 * @returns {{status: string, budgetAmount: number|null,
 *   predictedUtilizationPercentage: number|null,
 *   predictedRemaining: number|null}}
 */
function evaluate({ predictedTotal, targetMonthBudget } = {}) {
  const statuses = RULES.budgetRisk.statuses;

  // No usable prediction -> nothing can honestly be compared against a
  // budget, even when a budget genuinely exists.
  if (!isFiniteNumber(predictedTotal)) {
    return {
      status: statuses.insufficientData,
      budgetAmount: null,
      predictedUtilizationPercentage: null,
      predictedRemaining: null,
    };
  }

  const rawBudget =
    targetMonthBudget && typeof targetMonthBudget === "object" ? Number(targetMonthBudget.budget) : NaN;

  // A missing document, a non-numeric budget, or a zero/negative budget all
  // mean "no budget applies to the target month" -- never an implied 0-limit
  // budget the user would instantly be 'over'.
  if (!Number.isFinite(rawBudget) || rawBudget <= 0) {
    return {
      status: statuses.noBudget,
      budgetAmount: null,
      predictedUtilizationPercentage: null,
      predictedRemaining: null,
    };
  }

  const utilization = (predictedTotal / rawBudget) * 100;
  const budgetStatus = budgetStatusForUtilization(utilization);
  const status = FORECAST_STATUS_BY_BUDGET_STATUS[budgetStatus] ?? statuses.high;

  return {
    status,
    budgetAmount: round2(rawBudget),
    predictedUtilizationPercentage: round2(utilization),
    // Signed on purpose: a negative remaining is the honest way to say the
    // prediction exceeds the budget, and is never clamped to zero.
    predictedRemaining: round2(rawBudget - predictedTotal),
  };
}

module.exports = {
  evaluate,
};
