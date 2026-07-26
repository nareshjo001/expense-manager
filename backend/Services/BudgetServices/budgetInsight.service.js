const toSafeNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const generateBudgetInsights = (budgetReport = {}) => {
  const {
    hasBudget,
    status,
    projectionStatus,
    currentStreak,
    daysUntilExhaustion,
  } = budgetReport;

  const budget = toSafeNumber(budgetReport.budget);
  const spent = toSafeNumber(budgetReport.spent);
  const remainingBudget = toSafeNumber(budgetReport.remainingBudget);
  const budgetLeft = toSafeNumber(budgetReport.budgetLeft);
  const utilization = toSafeNumber(budgetReport.utilization);
  const exceededBy = toSafeNumber(budgetReport.exceededBy);
  const projectedOverspend = toSafeNumber(budgetReport.projectedOverspend);
  const projectedOverspendPercent = toSafeNumber(budgetReport.projectedOverspendPercent);

  // 1. No budget configured
  if (!hasBudget) {
    return spent === 0
      ? {
          type: "OTHERS",
          title: "No Budget Set",
          message: "You haven't set a monthly budget yet.",
          tip: "Set a monthly budget to receive spending forecasts and alerts.",
        }
      : {
          type: "OTHERS",
          title: "No Budget Set",
          message: `You've spent ₹${spent} with no monthly budget configured.`,
          tip: "Set a monthly budget to track utilization and get overspend alerts.",
        };
  }

  // 2. Budget exists but nothing spent
  if (spent === 0) {
    return {
      type: "OTHERS",
      title: "No Spending Recorded",
      message: "You haven't recorded any expenses this month.",
      tip: "Add your expenses to begin tracking your budget.",
    };
  }

  // 3. Already over budget — strongest possible signal, always wins
  if (status === "Overspent") {
    return {
      type: "EXCEEDED",
      title: "Budget Exceeded",
      message: `You've exceeded your budget by ₹${exceededBy}.`,
      tip: "Avoid additional spending this month and review large purchases.",
    };
  }

  // 4. Forecast says you WILL exceed — more urgent than "at risk"
  if (projectionStatus === "ProjectedOverspend") {
    return {
      type: "HIGH_RISK",
      title: "Projected Budget Overspend",
      message: `At your current spending pace, you're projected to exceed your budget by ₹${projectedOverspend} (${projectedOverspendPercent}%).`,
      tip:
        daysUntilExhaustion !== null
          ? `Your budget may run out in about ${daysUntilExhaustion} day${daysUntilExhaustion === 1 ? "" : "s"}.`
          : "Reduce your daily spending to stay within budget.",
    };
  }

  // 5. Current utilization already 90–100% — actual state beats prediction
  if (status === "Critical") {
    return {
      type: "CRITICAL",
      title: "Budget Nearly Exhausted",
      message: `You've already used ${utilization}% of your monthly budget.`,
      tip: `Only ₹${remainingBudget} remains.`,
    };
  }

  // 6. Forecast says you're trending toward the limit, but not there yet
  if (projectionStatus === "AtRisk") {
    return {
      type: "AT_RISK",
      title: "Budget At Risk",
      message: "Your current spending trend leaves very little room before reaching your budget.",
      tip: `₹${remainingBudget} (${budgetLeft}% remaining) is left. Spend cautiously for the rest of the month.`,
    };
  }

  // 7. Moderate utilization (70–90%)
  if (status === "Warning") {
    return {
      type: "WARNING",
      title: "Approaching Budget Limit",
      message: `You've used ${utilization}% of your budget.`,
      tip: `₹${remainingBudget} (${budgetLeft}% remaining) is still available.`,
    };
  }

  // 8. Safe — default
  return {
    type: "SAFE",
    title: "Budget On Track",
    message: `You've spent ₹${spent} out of ₹${budget}.`,
    tip:
      currentStreak > 1
        ? `Excellent! You've stayed within budget for ${currentStreak} consecutive months.`
        : `₹${remainingBudget} remains. Keep maintaining your current spending pace.`,
  };
};

module.exports = { generateBudgetInsights };