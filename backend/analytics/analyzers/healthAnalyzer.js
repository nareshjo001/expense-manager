const rules = require('./config/scoringRules');

const calculateTrendScore = (
  trend = {}
) => {

  return (
    rules.trend.direction[
      trend.spendingDirection
    ] || 0
  );

};

const calculateHabitScore = (
  habits = {}
) => {

  let score = 0;

  const impulse =
    habits.impulseSpending
      ?.spendingPercentage ?? 0;

  if (
    impulse <
    rules.habits.impulse.low
  ) {

    score +=
      rules.habits.impulse.scores.low;

  } else if (
    impulse <
    rules.habits.impulse.medium
  ) {

    score +=
      rules.habits.impulse.scores.medium;

  } else {

    score +=
      rules.habits.impulse.scores.high;

  }

  const micro =
    habits.microSpending
      ?.contributionPercentage ?? 0;

  if (
    micro <
    rules.habits.micro.low
  ) {

    score +=
      rules.habits.micro.scores.low;

  } else if (
    micro <
    rules.habits.micro.medium
  ) {

    score +=
      rules.habits.micro.scores.medium;

  } else {

    score +=
      rules.habits.micro.scores.high;

  }

  const ratio =
    habits.weekendVsWeekday
      ?.weekendRatio ?? 1;

  if (
    ratio <=
    rules.habits.weekendRatio
      .balanced
  ) {

    score +=
      rules.habits.weekendRatio
        .scores.balanced;

  } else {

    score +=
      rules.habits.weekendRatio
        .scores.unbalanced;

  }

  if (
    habits.subscriptionPattern
      ?.totalSubscriptions >
    rules.habits.subscriptionPenalty
      .threshold
  ) {

    score -=
      rules.habits.subscriptionPenalty
        .penalty;

  }

  if (
    habits.shoppingFrequency
      ?.shoppingTransactions >
    rules.habits
      .shoppingFrequencyPenalty
      .threshold
  ) {

    score -=
      rules.habits
        .shoppingFrequencyPenalty
        .penalty;

  }

  return Math.max(0, score);

};

const calculateStabilityScore = ({
  budget = {},
  trend = {},
  monthlyHabits = {}
}) => {

  let score = 0;

  // Budget streak (0-3)
  if (budget.currentStreak >= 6) {
    score += 3;
  } else if (budget.currentStreak >= 3) {
    score += 2;
  } else if (budget.currentStreak >= 1) {
    score += 1;
  }

  // Current month not overspent (0-2)
  if (!budget.isOverspent) {
    score += 2;
  }

  // Spending trend (0-2)
  if (trend.spendingDirection === "Decreasing") {
    score += 2;
  } else if (trend.spendingDirection === "Stable") {
    score += 1;
  }

  // Weekend balance (0-2)
  const ratio =
    monthlyHabits.weekendVsWeekday?.weekendRatio ?? 1;

  if (ratio >= 0.8 && ratio <= 1.2) {
    score += 2;
  }

  // No projected overspend (0-1)
  if (budget.projectedOverspend === 0) {
    score += 1;
  }

  return Math.min(score, 10);

};

const calculateHealthScore = (scores) => {

  const total =
    scores.budget +
    scores.trend +
    scores.habit +
    scores.category +
    scores.stability;

  const healthScore = Number(
    ((total / 110) * 100).toFixed(1)
  );

  return Math.min(100, healthScore);

};

const calculateRiskLevel = (score) => {

  return (
    rules.riskLevels.find(level =>
      score >= level.min
    ) || rules.riskLevels.at(-1)
  );

};

const generateStrengths = ({
  budget = {},
  trend = {},
  monthlyHabits = {},
  monthlyCategories = {}
}) => {

  const strengths = [];

  if (budget.currentStreak >= 3) {
    strengths.push(
      "Maintains budget consistently."
    );
  }

  if (!budget.isOverspent) {
    strengths.push(
      "Stayed within this month's budget."
    );
  }

  if (
    trend.spendingDirection ===
    "Decreasing"
  ) {
    strengths.push(
      "Overall spending trend is improving."
    );
  }

  if (
    monthlyHabits.microSpending
      ?.contributionPercentage < 10
  ) {
    strengths.push(
      "Very little money is lost to micro spending."
    );
  }

  if (
    monthlyHabits.impulseSpending
      ?.spendingPercentage < 20
  ) {
    strengths.push(
      "Impulse spending is well controlled."
    );
  }

  const highest =
    monthlyCategories
      ?.categoryDistribution?.[0];

  if (
    highest &&
    highest.percentage < 35
  ) {
    strengths.push(
      "Spending is well distributed across categories."
    );
  }

  return strengths;

};

const generateWeaknesses = ({
  budget = {},
  trend = {},
  monthlyHabits = {},
  monthlyCategories = {}
}) => {

  const weaknesses = [];

  if (budget.isOverspent) {
    weaknesses.push(
      "Current month's budget has been exceeded."
    );
  }

  if (
    budget.projectedOverspend > 0
  ) {
    weaknesses.push(
      "Current spending pace may exceed the monthly budget."
    );
  }

  if (
    trend.spendingDirection ===
    "Increasing"
  ) {
    weaknesses.push(
      "Spending is increasing compared to previous periods."
    );
  }

  if (
    monthlyHabits.impulseSpending
      ?.spendingPercentage > 35
  ) {
    weaknesses.push(
      "High impulse spending detected."
    );
  }

  if (
    monthlyHabits.microSpending
      ?.contributionPercentage > 20
  ) {
    weaknesses.push(
      "Frequent micro expenses are adding up."
    );
  }

  const highest =
    monthlyCategories
      ?.categoryDistribution?.[0];

  if (
    highest &&
    highest.percentage > 50
  ) {
    weaknesses.push(
      `${highest.category} dominates your spending.`
    );
  }

  return weaknesses;

};

const generateRecommendations = ({
  budget = {},
  monthlyHabits = {},
  monthlyCategories = {}
}) => {

  const recommendations = [];

  if (
    budget.projectedOverspend > 0
  ) {
    recommendations.push(
      "Reduce discretionary spending for the remainder of the month."
    );
  }

  if (
    monthlyHabits.impulseSpending
      ?.spendingPercentage > 35
  ) {
    recommendations.push(
      "Create a weekly shopping budget to reduce impulse purchases."
    );
  }

  if (
    monthlyHabits.subscriptionPattern
      ?.totalSubscriptions > 8
  ) {
    recommendations.push(
      "Review recurring subscriptions and cancel unused ones."
    );
  }

  if (
    monthlyHabits.microSpending
      ?.contributionPercentage > 20
  ) {
    recommendations.push(
      "Track small daily purchases to avoid unnecessary spending."
    );
  }

  const highest =
    monthlyCategories
      ?.categoryDistribution?.[0];

  if (
    highest &&
    highest.percentage > 50
  ) {
    recommendations.push(
      `Set a spending limit for ${highest.category}.`
    );
  }

  return recommendations;

};

const analyze = ({
  spending = {},
  budget = {},
  trend = {},
  monthlyCategories = {},
  yearlyCategories = {},
  monthlyHabits = {},
  yearlyHabits = {},
}) => {

  const scores = {
    budget: calculateBudgetScore(budget),
    trend: calculateTrendScore(trend),
    habit: calculateHabitScore(monthlyHabits),
    category: calculateCategoryScore(monthlyCategories),
    stability: calculateStabilityScore({
      budget,
      trend,
      monthlyHabits
    })
  };

  const overall =
    calculateHealthScore(scores);

  const risk =
    calculateRiskLevel(overall);

  return {

    scores: {
      ...scores,
      overall
    },

    risk,

    strengths:
      generateStrengths({
        budget,
        trend,
        monthlyHabits,
        monthlyCategories
      }),

    weaknesses:
      generateWeaknesses({
        budget,
        trend,
        monthlyHabits,
        monthlyCategories
      }),

    recommendations:
      generateRecommendations({
        budget,
        monthlyHabits,
        monthlyCategories
      })

  };

};

module.exports = {
  analyze,
}