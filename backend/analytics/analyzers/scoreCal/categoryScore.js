const rules = require("../scores/categoryRules");

const REASONS = {
  NO_EXPENSE_DATA: "NO_EXPENSE_DATA",
};

const emptyResult = (reason) => ({
  score: null,
  maxScore: rules.category.maxScore,
  normalizedScore: null,
  reason,
  breakdown: null,
});

const calculateCategoryScore = (categoryAnalysis = {}) => {
  if (categoryAnalysis.hasData === false) {
    return emptyResult(REASONS.NO_EXPENSE_DATA);
  }

  const highest = categoryAnalysis?.categoryDistribution?.[0];
  if (!highest) {
    return emptyResult(REASONS.NO_EXPENSE_DATA);
  }

  const percentage = Math.min(100, Math.max(0, Number(highest.percentage) || 0));

  const tier =
    rules.category.concentrationPenalty.find((rule) => percentage <= rule.max) ||
    rules.category.concentrationPenalty[rules.category.concentrationPenalty.length - 1];

  const normalizedScore = Number(((tier.score / rules.category.maxScore) * 100).toFixed(2));

  return {
    score: tier.score,
    maxScore: rules.category.maxScore,
    normalizedScore, // 0-100, safe to combine/compare with other score modules
    reason: null,
    breakdown: {
      topCategory: highest.category,
      topCategoryPercentage: percentage,
      tier: tier.label,
      points: tier.score,
      // Beyond top-1: lets the assistant say something like "your top
      // category alone isn't extreme, but your top 3 combined are 88%
      // of spend" — a genuinely different, useful insight.
      top3Concentration: categoryAnalysis.top3Concentration ?? null,
      concentrationIndex: categoryAnalysis.concentrationIndex ?? null,
    },
  };
};

module.exports = {
  calculateCategoryScore,
  REASONS,
};