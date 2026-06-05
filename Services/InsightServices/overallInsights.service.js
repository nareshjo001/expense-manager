// --------------------- STABILITY SCORE ---------------------
const getStabilityInsight = (score) => {

  if (score >= 80) {
    return {
      label: "Very Consistent",
      message: "Your spending pattern remains fairly predictable throughout the month."
    };
  }

  if (score >= 60) {
    return {
      label: "Consistent",
      message: "Your expenses follow a mostly steady pattern."
    };
  }

  if (score >= 40) {
    return {
      label: "Some Variability",
      message: "Your spending changes moderately across different days."
    };
  }

  return {
    label: "Irregular Spending",
    message: "Your expenses fluctuate significantly across the month."
  };
};

const calStabilityScore = (expenses) => {
  if (!Array.isArray(expenses) || expenses.length === 0) {
    return {
      stabilityScore: 0,
      stabilityInsight: null
    };
  }

  const dailyTotals = {};

  expenses.forEach((exp) => {
    const date = exp?.expenseDate;
    const amount = Number(exp?.expenseAmount);

    if (!date || Number.isNaN(amount)) return;

    if (!dailyTotals[date]) {
      dailyTotals[date] = 0;
    }

    dailyTotals[date] += amount;
  });

  const values = Object.values(dailyTotals);

  if (values.length === 0) {
    return {
      stabilityScore: 0,
      stabilityInsight: getStabilityInsight(0)
    };
  }

  const total = values.reduce((a, b) => a + b, 0);
  const avg = total / values.length;

  if (!Number.isFinite(avg) || avg <= 0) {
    return {
      stabilityScore: 0,
      stabilityInsight: getStabilityInsight(0)
    };
  }

  const variance =
    values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;

  const stdDev = Math.sqrt(variance);

  let stability = 100 - (stdDev / avg) * 100;

  if (!Number.isFinite(stability)) {
    stability = 0;
  }

  stability = Math.max(0, Math.min(100, stability));

  const stabilityScore = Math.round(stability);
  const stabilityInsight = getStabilityInsight(stabilityScore);

  return {
    stabilityScore,
    stabilityInsight
  };
};

// --------------------- BUDGET STREAK ---------------------
const getBudgetStreak = (budgets) => {
  if (!budgets.length || budgets.every(b => b.spent === 0)) {
    return { streak: 0 };
  }

  const monthMap = {
      Jan: 1, Feb: 2, Mar: 3, Apr: 4,
      May: 5, Jun: 6, Jul: 7, Aug: 8,
      Sep: 9, Oct: 10, Nov: 11, Dec: 12
  };

  const processed = budgets.map(b => {

      const [monthStr, yearStr] = b.month.split(" ");

      return {
        year: Number(yearStr),
        month: monthMap[monthStr],
        budget: b.budget,
        spent: b.spent,
        withinBudget: b.spent <= b.budget
      };

  });

  processed.sort((a, b) => {
      if (a.year === b.year) {
        return a.month - b.month;
      }
      return a.year - b.year;
  });

  let streak = 0;

  for (let i = processed.length - 1; i >= 0; i--) {

      if (processed[i].withinBudget) {
        streak++;
      } else {
        break;
      }

  }

  return { streak };
}

const getBiggestSpendingJump = (currentMonthExpenses, previousMonthExpenses) => {
  if (!Array.isArray(currentMonthExpenses) || !Array.isArray(previousMonthExpenses)) {
    return null;
  }

  const calculateCategoryTotals = (expenses) => {
    return expenses.reduce((acc, exp) => {
      const category =
        exp.expenseCategory || "Other";
      const amount =
        Number(exp.expenseAmount || 0);

      if (!acc[category]) {
        acc[category] = 0;
      }
      acc[category] += amount;
      return acc;
    }, {});
  };

  const currentTotals = calculateCategoryTotals(currentMonthExpenses);
  const previousTotals = calculateCategoryTotals(previousMonthExpenses);

  let biggestJump = null;
  let highestIncreasePercent = 0;

  Object.keys(currentTotals).forEach(category => {

    const current = currentTotals[category] || 0;
    const previous = previousTotals[category] || 0;

    /* ---------- SKIP WEAK DATA ---------- */

    if ( current < 500 || previous === 0) {
      return;
    }

    const increasePercent = ((current - previous) / previous) * 100;

    /* ---------- ONLY POSITIVE SPIKES ---------- */
    if (increasePercent > highestIncreasePercent && increasePercent >= 25) {

      highestIncreasePercent = increasePercent;

      biggestJump = {
        category,
        previousAmount: Math.round(previous),
        currentAmount: Math.round(current),
        increasePercent: Math.round(increasePercent),
        increaseAmount: Math.round(current - previous)
      };
    }
  });

  if (!biggestJump) {

    return {
      type: "NO_SIGNIFICANT_CHANGE",
      title: "Stable Spending",
      message:
        "No major category spikes detected this month.",
      insightType: "STABLE"
    };

  }

  /* =====================================================
     SIGNIFICANT SPIKE FOUND
  ===================================================== */
  return {
    type: "SPENDING_SPIKE",
    title: "Biggest Spending Jump",
    message: `${biggestJump.category} spending increased by ${biggestJump.increasePercent}% this month.`,
    subMessage: `You spent ₹${biggestJump.currentAmount} compared to ₹${biggestJump.previousAmount} last month.`,
    insightType: "SPIKE",
    data: biggestJump
  };
  
}

module.exports = {
  calStabilityScore,
  getBudgetStreak,
  getBiggestSpendingJump
}