// Risk Intelligence V1: pure, deterministic, explainable risk analyzer -- no DB/Redis/HTTP/ML-service/SIA calls, no `new Date()`; consumes only already-computed report sections (never raw collections); every signal is a concrete rule-based check with one fixed reason code and severity (see scores/riskRules.js), no opaque aggregate score, no probabilistic language.
"use strict";

const { risk: RULES } = require("./scores/riskRules");

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const round2 = (value) => Number(Number(value).toFixed(2));

const SEVERITY_RANK = { low: 0, moderate: 1, high: 2 };

// Deterministic tie-break: severity descending, then reasonCode ascending -- never insertion order or a hidden timestamp.
function compareSignals(a, b) {
  const rankDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (rankDiff !== 0) return rankDiff;
  if (a.reasonCode < b.reasonCode) return -1;
  if (a.reasonCode > b.reasonCode) return 1;
  return 0;
}

function buildSignal(reasonCode, evidence) {
  return {
    reasonCode,
    severity: RULES.signalSeverity[reasonCode],
    evidence,
  };
}

// -- individual signal evaluators -- each returns a signal object or null; evidence fields are plain number/string/boolean values already present on the source section -- no raw record, user identifier, or internal sort key.

function evaluateBudgetOverspent(budgets) {
  if (!isPlainObject(budgets) || budgets.hasData !== true || budgets.hasBudget !== true) return null;
  if (budgets.isOverspent !== true) return null;
  if (!isFiniteNumber(budgets.exceededBy) || !isFiniteNumber(budgets.utilization)) return null;

  return buildSignal("BUDGET_ALREADY_OVERSPENT", {
    exceededBy: round2(budgets.exceededBy),
    utilization: round2(budgets.utilization),
  });
}

// Deliberately mutually exclusive with evaluateBudgetOverspent (only runs when isOverspent is explicitly false), so one "budget under pressure" condition is never double-counted.
function evaluateLowRemainingBudget(budgets) {
  if (!isPlainObject(budgets) || budgets.hasData !== true || budgets.hasBudget !== true) return null;
  if (budgets.isOverspent !== false) return null;
  if (!isFiniteNumber(budgets.utilization) || !isFiniteNumber(budgets.remainingBudget)) return null;
  if (budgets.utilization < RULES.lowRemainingBudgetUtilizationPercent) return null;

  return buildSignal("LOW_REMAINING_BUDGET", {
    utilization: round2(budgets.utilization),
    remainingBudget: round2(budgets.remainingBudget),
  });
}

function evaluatePersistentSpendingGrowth(trends) {
  const percentageChange = trends && trends.monthlyTrend && trends.monthlyTrend.percentageChange;
  if (!isFiniteNumber(percentageChange)) return null;
  if (percentageChange < RULES.spendingGrowthPercent) return null;

  return buildSignal("PERSISTENT_SPENDING_GROWTH", {
    percentageChange: round2(percentageChange),
  });
}

function evaluateAbnormalHighValueExpenses(anomalies) {
  if (!isPlainObject(anomalies) || anomalies.hasData !== true) return null;
  const list = Array.isArray(anomalies.anomalies) ? anomalies.anomalies : [];

  const risky = list.filter(
    (a) => a && typeof a === "object" && RULES.anomalySeveritiesConsideredRisky.includes(a.severity)
  );

  if (risky.length === 0) return null;

  // Bounded, allowlisted evidence -- only fields already safe on the anomaly record's own output contract (never userId, raw expense objects, or sort keys).
  const evidenceAnomalies = risky.slice(0, RULES.maxAnomalyEvidenceCount).map((a) => ({
    expenseId: a.expenseId,
    category: a.category,
    amount: a.amount,
    severity: a.severity,
  }));

  return buildSignal("ABNORMAL_HIGH_VALUE_EXPENSES", {
    flaggedCount: risky.length,
    anomalies: evidenceAnomalies,
  });
}

// Forecast is explicitly OPTIONAL evidence -- when missing/unavailable this signal is simply skipped (returns null), never fails the whole analyzer or forces no-data.
function evaluateForecastedPressure(forecast, budgets) {
  const nextMonth = forecast && forecast.nextMonthForecast;
  if (!isPlainObject(nextMonth) || nextMonth.hasData !== true) return null;
  if (!isFiniteNumber(nextMonth.estimate)) return null;

  if (!isPlainObject(budgets) || budgets.hasData !== true || budgets.hasBudget !== true) return null;
  if (!isFiniteNumber(budgets.budget) || budgets.budget <= 0) return null;

  const ratio = nextMonth.estimate / budgets.budget;
  if (ratio < RULES.forecastPressureRatio) return null;

  return buildSignal("FORECASTED_FINANCIAL_PRESSURE", {
    forecastedAmount: round2(nextMonth.estimate),
    configuredBudget: round2(budgets.budget),
    ratio: round2(ratio),
  });
}

function evaluateDeterioratingHealth(financialHealth) {
  const overall = financialHealth && financialHealth.overall;
  if (!isFiniteNumber(overall)) return null;
  if (overall > RULES.deterioratingHealthScoreMax) return null;

  return buildSignal("DETERIORATING_HEALTH", {
    overall: round2(overall),
  });
}

/**
 * @param {object} input - already-computed, current report sections only.
 * @param {object} [input.spending]
 * @param {object} [input.budgets]
 * @param {object} [input.trends]
 * @param {object} [input.financialHealth]
 * @param {object} [input.anomalies]
 * @param {object} [input.forecast] - optional; missing/unavailable never invalidates the rest of the section.
 */
const analyze = ({ spending, budgets, trends, financialHealth, anomalies, forecast } = {}) => {
  const hasAnySourceData =
    (isPlainObject(spending) && spending.hasData === true) ||
    (isPlainObject(budgets) && budgets.hasData === true) ||
    (isPlainObject(trends) && trends.hasData === true) ||
    (isPlainObject(anomalies) && anomalies.hasData === true) ||
    (isPlainObject(forecast) && forecast.hasData === true) ||
    isPlainObject(financialHealth);

  if (!hasAnySourceData) {
    return {
      hasData: false,
      reasonCode: RULES.noDataReasonCode,
      riskLevel: "none",
      signalCount: 0,
      signals: [],
    };
  }

  const candidateSignals = [
    evaluateBudgetOverspent(budgets),
    evaluateLowRemainingBudget(budgets),
    evaluatePersistentSpendingGrowth(trends),
    evaluateAbnormalHighValueExpenses(anomalies),
    evaluateForecastedPressure(forecast, budgets),
    evaluateDeterioratingHealth(financialHealth),
  ].filter(Boolean);

  candidateSignals.sort(compareSignals);
  const signals = candidateSignals.slice(0, RULES.maxSignals);

  const riskLevel =
    signals.length === 0
      ? "none"
      : RULES.severityLevels[Math.max(...signals.map((s) => SEVERITY_RANK[s.severity]))];

  return {
    hasData: true,
    reasonCode: null,
    riskLevel,
    signalCount: signals.length,
    signals,
  };
};

module.exports = {
  analyze,
};
