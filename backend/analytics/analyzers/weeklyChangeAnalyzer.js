"use strict";

// ANL-001-T03 -- pure, deterministic, no I/O. Computes a volatility-adaptive
// week-over-week spending change signal, replacing
// frontend/src/insights-engine/rules/overallSpend.js +
// learning/thresholdAdapter/buildWeeklyBaseline.js (ANL-001-T02's contract,
// WeeklyChangeSignal). The volatility baseline is NOT recomputed here -- it
// reuses spendingAnalyzer.js's already-computed coefficientOfVariation
// (report.spending.stability), which is the analytics module's existing
// single source of weekly-spend volatility. Every money value is rounded
// with the shared roundMoney helper; changeRatio is a unitless ratio, not a
// currency amount, so it is rounded separately to 4 decimal places.

const { roundMoney: round2 } = require("../../utils/money");

const RULES = {
  reasonCodes: {
    noWeeklyExpenseData: "NO_WEEKLY_EXPENSE_DATA",
  },
  flatThresholdFallback: 0.3,
  minAdaptiveThreshold: 0.25,
  maxAdaptiveThreshold: 0.6,
};

const toSafeNumber = (value, fallback = 0) => {
  // Number() throws (rather than returning NaN) for an object with no
  // usable valueOf/toString -- e.g. Object.create(null) -- so a malformed
  // expenseAmount can't rely on Number.isFinite alone to catch it.
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

// Sums expenseAmount across a list of expenses, coercing each amount via
// Number(...) and treating non-finite/NaN values as 0, then rounds the
// total with the shared money helper.
const sumWeekTotal = (expenses = []) => {
  const list = Array.isArray(expenses) ? expenses : [];
  let total = 0;
  for (const expense of list) {
    total += toSafeNumber(expense?.expenseAmount);
  }
  return round2(total);
};

// Rounds a unitless ratio to 4 decimal places. Not a currency amount, so
// roundMoney (2dp, rupee-aware) does not apply here.
const roundRatio = (value) => Math.round(value * 10000) / 10000;

// Change ratio is null when there's no positive previous-week baseline to
// compare against (division by zero / no signal), otherwise the absolute
// relative change between the two week totals, rounded to 4dp.
const calculateChangeRatio = (currentWeekTotal, previousWeekTotal) => {
  if (previousWeekTotal <= 0) return null;
  return roundRatio(Math.abs(currentWeekTotal - previousWeekTotal) / previousWeekTotal);
};

// Volatility is taken directly from stability.coefficientOfVariation --
// treated as null when it is not a finite number (covers undefined/null/NaN).
const resolveVolatility = (stability = {}) => {
  const cov = stability?.coefficientOfVariation;
  return typeof cov === "number" && Number.isFinite(cov) ? cov : null;
};

// Adaptive threshold clamps volatility into [0.25, 0.6]; when volatility is
// unavailable, falls back to the flat 0.3 threshold.
const calculateAdaptiveThreshold = (volatility) => {
  if (volatility === null) return RULES.flatThresholdFallback;
  return Math.max(RULES.minAdaptiveThreshold, Math.min(RULES.maxAdaptiveThreshold, volatility));
};

const resolveDirection = (currentWeekTotal, previousWeekTotal) => {
  if (currentWeekTotal > previousWeekTotal) return "up";
  if (currentWeekTotal < previousWeekTotal) return "down";
  return "same";
};

// anomalySource is only meaningful once a change has been judged
// significant -- it attributes the anomaly to whichever week diverged.
const resolveAnomalySource = (isSignificant, direction) => {
  if (!isSignificant) return null;
  if (direction === "up") return "CURRENT_WEEK";
  if (direction === "down") return "PREVIOUS_WEEK";
  return null;
};

const analyze = ({ currentWeekExpenses = [], previousWeekExpenses = [], stability = {} } = {}) => {
  const currentList = Array.isArray(currentWeekExpenses) ? currentWeekExpenses : [];
  const previousList = Array.isArray(previousWeekExpenses) ? previousWeekExpenses : [];

  if (!currentList.length && !previousList.length) {
    return {
      hasData: false,
      reasonCode: RULES.reasonCodes.noWeeklyExpenseData,
      currentWeekTotal: 0,
      previousWeekTotal: 0,
      changeRatio: null,
      adaptiveThreshold: RULES.flatThresholdFallback,
      volatility: null,
      isSignificant: false,
      direction: "same",
      anomalySource: null,
    };
  }

  const currentWeekTotal = sumWeekTotal(currentList);
  const previousWeekTotal = sumWeekTotal(previousList);

  const changeRatio = calculateChangeRatio(currentWeekTotal, previousWeekTotal);
  const volatility = resolveVolatility(stability);
  const adaptiveThreshold = calculateAdaptiveThreshold(volatility);
  const isSignificant = changeRatio !== null && changeRatio >= adaptiveThreshold;
  const direction = resolveDirection(currentWeekTotal, previousWeekTotal);
  const anomalySource = resolveAnomalySource(isSignificant, direction);

  return {
    hasData: true,
    reasonCode: null,
    currentWeekTotal,
    previousWeekTotal,
    changeRatio,
    adaptiveThreshold,
    volatility,
    isSignificant,
    direction,
    anomalySource,
  };
};

module.exports = {
  sumWeekTotal,
  calculateChangeRatio,
  resolveVolatility,
  calculateAdaptiveThreshold,
  resolveDirection,
  resolveAnomalySource,
  analyze,
};
