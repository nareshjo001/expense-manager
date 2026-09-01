const rules = require("../scores/spendingRules");
 
const REASONS = {
  NO_EXPENSE_DATA: "NO_EXPENSE_DATA",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
};
 
const emptyResult = (reason) => ({
  score: null,
  maxScore: rules.spending.maxScore,
  normalizedScore: null,
  reason,
  breakdown: null,
});
 
const calculateSpendingScore = (spendingAnalysis = {}) => {
  if (spendingAnalysis.hasData === false) {
    return emptyResult(REASONS.NO_EXPENSE_DATA);
  }
 
  const cv = spendingAnalysis?.stability?.coefficientOfVariation;
 
  if (cv === null || cv === undefined || !Number.isFinite(Number(cv))) {
    // Could be < 14 tracked days, all-refund data, or bad dates — none
    // of these mean "unstable spending," they mean "can't tell yet."
    return emptyResult(REASONS.INSUFFICIENT_DATA);
  }
 
  const cvValue = Math.max(0, Number(cv));
 
  const tier =
    rules.spending.stabilityTiers.find((rule) => cvValue <= rule.max) ||
    rules.spending.stabilityTiers[rules.spending.stabilityTiers.length - 1];
 
  const normalizedScore = Number(((tier.score / rules.spending.maxScore) * 100).toFixed(2));
 
  return {
    score: tier.score,
    maxScore: rules.spending.maxScore,
    normalizedScore, // 0-100, safe to combine/compare with other score modules
    reason: null,
    breakdown: {
      coefficientOfVariation: cvValue,
      tier: tier.label,
      points: tier.score,
      // Context for the assistant — e.g. "your spending is volatile,
      largestExpense: spendingAnalysis.largestExpense ?? null,
      totalSpent: spendingAnalysis.totalSpent ?? null,
    },
  };
};
 
module.exports = { 
  calculateSpendingScore, 
  REASONS 
};