const rules = require("../scores/healthRules");

// Stability = consistency of financial DISCIPLINE across budget/trend/habits signals -- distinct from spendingScore's CV-based volatility, deliberately not merged though it partially overlaps.
const calculateStabilityScore = ({ budget = {}, trend = {}, habits = {} } = {}) => {
  if (budget.hasBudget === false && trend.hasData === false && habits.hasData === false) {
    return {
      score: null,
      maxScore: rules.stability.maxScore,
      normalizedScore: null,
      reason: "INSUFFICIENT_DATA",
    };
  }

  let score = 0;

  if (budget.hasBudget !== false) {
    const streak = Number(budget.currentStreak) || 0;
    if (streak >= 6) score += 3;
    else if (streak >= 3) score += 2;
    else if (streak >= 1) score += 1;

    if (budget.isOverspent === false) score += 2;
    if (Number(budget.projectedOverspend) === 0) score += 1;
  }

  if (trend.spendingDirection === "Decreasing") score += 2;
  else if (trend.spendingDirection === "Stable") score += 1;

  // Missing ratio -> no points either way (not defaulted to "balanced").
  const ratio = habits.weekendVsWeekday?.weekendRatio;
  if (ratio !== null && ratio !== undefined) {
    const { min, max } = rules.stability.weekendBalanced;
    if (ratio >= min && ratio <= max) score += 2;
  }

  const clamped = Math.min(score, rules.stability.maxScore);
  return {
    score: clamped,
    maxScore: rules.stability.maxScore,
    normalizedScore: Number(((clamped / rules.stability.maxScore) * 100).toFixed(2)),
    reason: null,
  };
};

// Weighted average of each module's normalizedScore -- score:null modules are excluded and remaining weights renormalized, so a missing module never counts as 0 or shrinks the max achievable score.
const calculateHealthScore = (scores = {}) => {
  const entries = Object.entries(rules.weights)
    .map(([key, weight]) => ({ key, weight, result: scores[key] }))
    .filter((e) => e.result?.normalizedScore !== null && e.result?.normalizedScore !== undefined);

  if (!entries.length) {
    return {
      overall: null,
      reason: "INSUFFICIENT_DATA",
      includedModules: [],
      excludedModules: Object.keys(rules.weights),
    };
  }

  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  const weightedSum = entries.reduce((sum, e) => sum + e.result.normalizedScore * e.weight, 0);

  return {
    overall: Number(Math.min(100, weightedSum / totalWeight).toFixed(1)),
    reason: null,
    includedModules: entries.map((e) => e.key),
    excludedModules: Object.keys(rules.weights).filter((k) => !entries.some((e) => e.key === k)),
  };
};

const calculateRiskLevel = (overall) => {
  if (overall === null || overall === undefined) {
    return { label: "Unknown", color: "gray", reason: "INSUFFICIENT_DATA" };
  }
  return (
    rules.riskLevels.find((level) => overall >= level.min) ?? rules.riskLevels[rules.riskLevels.length - 1]
  );
};

module.exports = { 
  calculateStabilityScore, 
  calculateHealthScore, 
  calculateRiskLevel 
};