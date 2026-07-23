const { calculateBudgetScore } = require("../analyzers/scoreCal/budgetScore");
const { calculateCategoryScore } = require("../analyzers/scoreCal/categoryScore");
const { calculateSpendingScore } = require("../analyzers/scoreCal/spendingScore");
const { calculateTrendScore } = require("../analyzers/scoreCal/trendScore");
const { calculateHabitScore } = require("../analyzers/scoreCal/habitScore");
const { calculateStabilityScore, calculateHealthScore, calculateRiskLevel } = require("../analyzers/scoreCal/healthScore");
const { generateSignals } = require("../analyzers/scores/healthSignals");

const analyze = ({ budget = {}, category = {}, spending = {}, trend = {}, habits = {} } = {}) => {
  const scores = {
    budget: calculateBudgetScore(budget),
    category: calculateCategoryScore(category),
    spending: calculateSpendingScore(spending),
    trend: calculateTrendScore(trend),
    habit: calculateHabitScore(habits),
    stability: calculateStabilityScore({ budget, trend, habits }),
  };
 
  const { overall, includedModules, excludedModules } = calculateHealthScore(scores);
  const risk = calculateRiskLevel(overall);
  const signals = generateSignals({ budget, trend, habits, category });
 
  return {
    scores,
    overall,
    dataCompleteness: { includedModules, excludedModules },
    risk,
    signals,
  };
};
 
module.exports = { analyze };