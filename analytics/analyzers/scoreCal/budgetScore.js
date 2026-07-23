const rules = require('../scores/budgetRules');

const REASONS = {
  NO_BUDGET_SET: "NO_BUDGET_SET",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
};

const emptyResult = (reason) => ({
  score: null,
  maxScore: rules.budget.maxScore,
  normalizedScore: null,
  reason,
  breakdown: null,
});

const calculateBudgetScore = (budgetAnalysis = {}) => {
  const { hasBudget, utilization, currentStreak, projectedOverspendPercent } = budgetAnalysis;

  if (hasBudget === false) {
    return emptyResult(REASONS.NO_BUDGET_SET);
  }

  const utilizationValue = Number(utilization);
  if (!Number.isFinite(utilizationValue)) {
    return emptyResult(REASONS.INSUFFICIENT_DATA);
  }

  const utilizationTier =
    rules.budget.utilizationTiers.find((tier) => utilizationValue <= tier.max) ||
    rules.budget.utilizationTiers[rules.budget.utilizationTiers.length - 1];
 
  const streakValue = Math.max(0, Number(currentStreak) || 0);
  const streakTier =
    rules.budget.streakTiers.find((tier) => streakValue >= tier.min) ||
    rules.budget.streakTiers[rules.budget.streakTiers.length - 1];
 
  let penalty = 0;
  const overspendPercent = Number(projectedOverspendPercent) || 0;
  if (overspendPercent > 0) {
    const { maxPenalty, penaltyScale } = rules.budget.projectedOverspendPenalty;
    penalty = Math.min(maxPenalty, (overspendPercent / 100) * penaltyScale);
  }
 
  const rawScore = utilizationTier.score + streakTier.score - penalty;
  const clampedScore = Math.max(0, Math.min(rules.budget.maxScore, rawScore));
  const normalizedScore = Number(((clampedScore / rules.budget.maxScore) * 100).toFixed(2));

  return {
    score: Number(clampedScore.toFixed(2)),
    maxScore: rules.budget.maxScore,
    normalizedScore,
    reason: null,

    breakdown: {
      utilization: {
        value: utilizationValue,
        tier: utilizationTier.label,
        points: utilizationTier.score,
      },
      streak: {
        value: streakValue,
        tier: streakTier.label,
        points: streakTier.score,
      },
      overspendPenalty: Number(penalty.toFixed(2)),
    },
  };
};

module.exports = {
  calculateBudgetScore,
  REASONS,
};