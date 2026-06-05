const analyzeBudget = (expenses, budget) => {
  if (!budget || !budget.budget) return null;

  if (!Array.isArray(expenses) || expenses.length === 0) {
    return null;
  }

  const today = new Date();

  /* ---------------- SORT EXPENSES ---------------- */
  const sortedExpenses = [...expenses].sort(
    (a, b) =>
      new Date(a.expenseDate) -
      new Date(b.expenseDate)
  );

  const firstExpenseDate = new Date(
    sortedExpenses[0].expenseDate
  );

  // Days user has actually been tracking expenses
  const trackingDays = Math.max(
    1,
    Math.ceil(
      (today - firstExpenseDate) / (1000 * 60 * 60 * 24)
    ) + 1
  );

  // Total days in current month
  const totalDays = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0
  ).getDate();

  // Remaining days in current month
  const remainingDays = Math.max(
    0,
    totalDays - today.getDate()
  );

  /* ---------------- SPENDING CALCULATIONS ---------------- */
  const totalSpent = expenses.reduce(
    (sum, e) => sum + Number(e.expenseAmount || 0),
    0
  );

  const avgDailySpend = totalSpent / trackingDays;

  // Predicted month-end spending
  const predictedSpend =
    totalSpent + avgDailySpend * remainingDays;

  const usagePercent =
    (totalSpent / budget.budget) * 100;

  // Remaining budget
  const remainingBudget =
    budget.budget - totalSpent;

  // Allowed daily spending from now
  const allowedDailySpend =
    remainingDays > 0
      ? remainingBudget / remainingDays
      : 0;

  /* =======================================================
     CASE 1 : BUDGET EXCEEDED
  ======================================================= */
  if (totalSpent > budget.budget) {

    const exceededAmount =
      totalSpent - budget.budget;

    return {
      type: "EXCEEDED",
      title: "Budget Exceeded",
      message:
        `You have exceeded your ₹${budget.budget} budget by ₹${Math.round(exceededAmount)}.`,
      tip:
        "Avoid additional spending this month to prevent further overshoot.",
      usagePercent: Math.round(usagePercent),
      totalSpent,
      predictedSpend: Math.round(predictedSpend),
      budget: budget.budget,
      avgDailySpend: Math.round(avgDailySpend),
      allowedDailySpend: 0,
      remainingBudget
    };
  }

  /* =======================================================
     CASE 2 : HIGH RISK
  ======================================================= */
  if (
    predictedSpend > budget.budget ||
    usagePercent >= 85
  ) {

    const reductionNeeded = Math.max(
      0,
      Math.round(
        avgDailySpend - allowedDailySpend
      )
    );

    return {
      type: "HIGH_RISK",
      title: "Budget Risk Alert",
      message:
        `You are on track to spend around ₹${Math.round(predictedSpend)} this month.`,
      tip:
        `Reduce daily spending by about ₹${reductionNeeded} to stay within budget.`,
      usagePercent: Math.round(usagePercent),
      totalSpent,
      predictedSpend: Math.round(predictedSpend),
      budget: budget.budget,
      avgDailySpend: Math.round(avgDailySpend),
      allowedDailySpend: Math.round(allowedDailySpend),
      remainingBudget
    };
  }

  /* =======================================================
     CASE 3 : WARNING
  ======================================================= */
  if (usagePercent >= 70) {

    return {
      type: "WARNING",
      title: "Approaching Budget Limit",
      message:
        "Your spending is increasing steadily this month.",
      tip:
        `Try keeping daily spending below ₹${Math.round(allowedDailySpend)}.`,
      usagePercent: Math.round(usagePercent),
      totalSpent,
      predictedSpend: Math.round(predictedSpend),
      budget: budget.budget,
      avgDailySpend: Math.round(avgDailySpend),
      allowedDailySpend: Math.round(allowedDailySpend),
      remainingBudget
    };
  }

  /* =======================================================
     CASE 4 : SAFE
  ======================================================= */
  return {
    type: "SAFE",
    title: "Budget On Track",
    message:
      "Your spending is within the budget.",
    tip:
      `You can safely spend about ₹${Math.round(allowedDailySpend)} per day.`,
    usagePercent: Math.round(usagePercent),
    totalSpent,
    predictedSpend: Math.round(predictedSpend),
    budget: budget.budget,
    avgDailySpend: Math.round(avgDailySpend),
    allowedDailySpend: Math.round(allowedDailySpend),
    remainingBudget
  };
};

module.exports = { analyzeBudget };