// Prediction Layer V1: answers "is the predicted next-month spend likely to exceed the budget that exists for that month?" (`no_budget` if none exists) -- not a second budget/health/risk calculator, reuses budgetAnalyzer.js's own STATUS_THRESHOLDS so tiers can't drift; target-month budget must already exist as its own document (budgets are per-calendar-month, never reused from the current month); pure/deterministic, no DB/Redis/HTTP/`new Date()`/input mutation.
"use strict";

const { forecast: RULES } = require("./scores/forecastRules");
const { STATUS_THRESHOLDS } = require("./budgetAnalyzer");

// DAT-001-T03 -- shared with every other money-rounding call site via
// backend/utils/money.js, instead of an independently redefined helper.
const { roundMoney: round2 } = require("../../utils/money");

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

// Collapses budgetAnalyzer.js's 4 ascending tiers (Safe/Warning/Critical/Overspent) onto 3 forecast statuses (Critical+Overspent -> `high`); numeric boundaries are never restated, only read from the imported thresholds at call time.
const FORECAST_STATUS_BY_BUDGET_STATUS = Object.freeze({
  Safe: RULES.budgetRisk.statuses.safe,
  Warning: RULES.budgetRisk.statuses.watch,
  Critical: RULES.budgetRisk.statuses.high,
  Overspent: RULES.budgetRisk.statuses.high,
});

// Mirrors budgetAnalyzer.js's own tier walk exactly (first tier whose `max` the utilization falls under wins).
function budgetStatusForUtilization(utilization) {
  const tier = STATUS_THRESHOLDS.find((candidate) => utilization <= candidate.max);
  return tier ? tier.status : null;
}

/* @param {object} input */
function evaluate({ predictedTotal, targetMonthBudget } = {}) {
  const statuses = RULES.budgetRisk.statuses;

  // No usable prediction -- nothing can honestly be compared against a budget, even when one exists.
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

  // Missing document, non-numeric, or zero/negative budget all mean "no budget applies" -- never an implied 0-limit.
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
    // Signed on purpose -- negative remaining honestly signals the prediction exceeds budget; never clamped to zero.
    predictedRemaining: round2(rawBudget - predictedTotal),
  };
}

module.exports = {
  evaluate,
};
