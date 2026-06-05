// --------------- WEEKLY SPENDING HABIT ---------------
const getWeekendInsight = (weekendAvg, weekdayAvg, expensesCount) => {

  if (expensesCount < 6) {

    return {
      title: "Not enough data",
      message:
        "Add more expenses to analyze your weekly spending habits.",
      insightType: "INSUFFICIENT_DATA"
    };

  }

  if (weekdayAvg === 0 && weekendAvg === 0) {
    return {
      title: "No spending pattern detected",
      message: "No meaningful spending pattern was found.",
    };
  }

  const diffPercent =
    weekdayAvg > 0
      ? ((weekendAvg - weekdayAvg) / weekdayAvg) * 100
      : 0;

  const diff = Math.round(diffPercent);

  if (diff >= 40) {

    return {
      title: "Weekend Spender",
      message: `You spend ${diff}% more on weekends.`,
      insightType: "WEEKEND_HEAVY"
    };

  }

  if (diff >= 15) {

    return {
      title: "Weekend Leaning",
      message: `Your spending slightly increases on weekends.`,
      insightType: "WEEKEND_SLIGHT"
    };

  }

  if (diff <= -35) {

    return {
      title: "Weekday Spender",
      message: `You spend ${Math.abs(diff)}% more during weekdays.`,
      insightType: "WEEKDAY_HEAVY"
    };

  }

  return {
    title: "Balanced Spending",
    message: "Your spending is evenly distributed across the week.",
    insightType: "BALANCED"
  };

};

const weekSpendingHabit = (expenses) => {
  let weekendTotal = 0;
  let weekdayTotal = 0;

  const weekendDays = new Set();
  const weekdayDays = new Set();

  expenses.forEach(exp => {

    const date = new Date(exp.expenseDate);
    const day = date.getDay();
    const amount = Number(exp.expenseAmount || 0);

    const formattedDate =
      date.toISOString().split("T")[0];

    if (day === 0 || day === 6) {

      weekendTotal += amount;
      weekendDays.add(formattedDate);

    } else {

      weekdayTotal += amount;
      weekdayDays.add(formattedDate);

    }

  });

  const weekendActiveDays =
    Math.max(1, weekendDays.size);

  const weekdayActiveDays =
    Math.max(1, weekdayDays.size);

  const weekendAvg =
    weekendTotal / weekendActiveDays;

  const weekdayAvg =
    weekdayTotal / weekdayActiveDays;

  const diffPercent =
    weekdayAvg > 0
      ? ((weekendAvg - weekdayAvg) / weekdayAvg) * 100
      : 0;

  const insight = getWeekendInsight(
    weekendAvg,
    weekdayAvg,
    expenses.length
  );
  
  return {
    weekendInsight: {
      weekendAvg: Math.round(weekendAvg),
      weekdayAvg: Math.round(weekdayAvg),
      difference: Math.round(diffPercent),
      insight
    }
  }
} 

// --------------- LEAKY BUCKET ---------------
const getLeakyBucketInsight = (expenses, budget = null) => {
  if (!Array.isArray(expenses) || expenses.length === 0) return null;

  const totalSpent = expenses.reduce(
    (sum, e) =>
      sum + Number(e.expenseAmount || 0),
    0
  );

  const avgExpense =
    totalSpent / expenses.length;

  const microThreshold =
    Math.max(
      50,
      Math.round(avgExpense * 0.18)
    );

  const smallExpenses = expenses.filter(e => {

    const amount =
      Number(e.expenseAmount || 0);

    return (
      amount > 0 &&
      amount <= microThreshold
    );

  });

  const leakTotal = smallExpenses.reduce(
    (sum, e) =>
      sum + Number(e.expenseAmount || 0),
    0
  );

  const transactionCount =
    smallExpenses.length;

  const percentOfTotal =
    totalSpent > 0
      ? (leakTotal / totalSpent) * 100
      : 0;

  // Only show if meaningful
  if ( transactionCount < 5 || leakTotal < 300 || percentOfTotal < 10) {
    return null;
  }

  return {
    message:
      `Small frequent expenses contributed around ₹${Math.round(leakTotal)} this month.`,
    subMessage:
      `${Math.round(percentOfTotal)}% of your spending came from micro-transactions.`,
    leakTotal: Math.round(leakTotal),
    count: transactionCount,
    percent: Math.round(percentOfTotal * 10) / 10,
    averageLeak: Math.round(leakTotal / transactionCount),
    type: "LEAKY_BUCKET"
  };
};

module.exports = { weekSpendingHabit, getLeakyBucketInsight }