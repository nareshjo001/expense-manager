const rules = require("./healthRules");

const T = rules.insightThresholds;

// Emits structured signals (facts + numbers, not final sentences) -- an LLM turns these into narrative, so every number stays traceable to a real computed value, never invented.
const generateSignals = ({ budget = {}, trend = {}, habits = {}, category = {} } = {}) => {
  const signals = [];
  const push = (type, id, metric, value, message) => signals.push({ type, id, metric, value, message });

  if (budget.hasBudget !== false) {
    if ((budget.currentStreak ?? 0) >= 3) {
      push("strength", "BUDGET_STREAK", "currentStreak", budget.currentStreak, "Maintains budget consistently.");
    }
    if (budget.isOverspent === false) {
      push("strength", "BUDGET_WITHIN_LIMIT", "isOverspent", false, "Stayed within this month's budget.");
    }
    if (budget.isOverspent === true) {
      push("weakness", "BUDGET_EXCEEDED", "exceededBy", budget.exceededBy, "Current month's budget has been exceeded.");
    }
    if ((budget.projectedOverspend ?? 0) > 0) {
      push(
        "weakness",
        "PROJECTED_OVERSPEND",
        "projectedOverspendPercent",
        budget.projectedOverspendPercent,
        "Current spending pace may exceed the monthly budget."
      );
      push(
        "recommendation",
        "REDUCE_DISCRETIONARY",
        "projectedOverspendPercent",
        budget.projectedOverspendPercent,
        "Reduce discretionary spending for the remainder of the month."
      );
    }
  }

  if (trend.hasData !== false) {
    if (trend.spendingDirection === "Decreasing") {
      push("strength", "TREND_DECREASING", "spendingDirection", trend.spendingDirection, "Overall spending trend is improving.");
    } else if (trend.spendingDirection === "Increasing") {
      push("weakness", "TREND_INCREASING", "spendingDirection", trend.spendingDirection, "Spending is increasing compared to previous periods.");
    }
  }

  if (habits.hasData !== false) {
    const microPct = habits.microSpending?.contributionPercentage;
    if (microPct !== null && microPct !== undefined) {
      if (microPct < T.microSpendingLow) {
        push("strength", "MICRO_LOW", "contributionPercentage", microPct, "Very little money is lost to micro spending.");
      }
      if (microPct > T.microSpendingHigh) {
        push("weakness", "MICRO_HIGH", "contributionPercentage", microPct, "Frequent micro expenses are adding up.");
        push("recommendation", "MICRO_HIGH_REC", "contributionPercentage", microPct, "Track small daily purchases to avoid unnecessary spending.");
      }
    }

    const impulsePct = habits.impulseSpending?.amountSharePercentage;
    if (impulsePct !== null && impulsePct !== undefined) {
      if (impulsePct < T.impulseSpendingLow) {
        push("strength", "IMPULSE_LOW", "amountSharePercentage", impulsePct, "Impulse spending is well controlled.");
      }
      if (impulsePct > T.impulseSpendingHigh) {
        push("weakness", "IMPULSE_HIGH", "amountSharePercentage", impulsePct, "High impulse spending detected.");
        push("recommendation", "IMPULSE_HIGH_REC", "amountSharePercentage", impulsePct, "Create a weekly shopping budget to reduce impulse purchases.");
      }
    }

    const subCount = habits.subscriptionPattern?.totalSubscriptions ?? 0;
    if (subCount > T.subscriptionCountHigh) {
      push("recommendation", "SUBSCRIPTIONS_HIGH", "totalSubscriptions", subCount, "Review recurring subscriptions and cancel unused ones.");
    }
  }

  if (category.hasData !== false) {
    const top = category.categoryDistribution?.[0];
    if (top) {
      if (top.percentage < T.categoryConcentrationLow) {
        push("strength", "CATEGORY_DIVERSIFIED", "topCategoryPercentage", top.percentage, "Spending is well distributed across categories.");
      }
      if (top.percentage > T.categoryConcentrationHigh) {
        push("weakness", "CATEGORY_CONCENTRATED", "topCategoryPercentage", top.percentage, `${top.category} dominates your spending.`);
        push("recommendation", "CATEGORY_LIMIT_REC", "topCategoryPercentage", top.percentage, `Set a spending limit for ${top.category}.`);
      }
    }
  }

  return signals;
};

module.exports = { generateSignals };