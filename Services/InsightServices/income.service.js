const getFinancialRunwayData = (
  totalIncome,
  totalExpenses,
  trackedDays
) => {
  if (
    !trackedDays ||
    trackedDays <= 0 ||
    totalExpenses <= 0
  ) {
    return null;
  }

  const currentBalance = totalIncome - totalExpenses;
  const averageDailyExpense = totalExpenses / trackedDays;

  // Handle negative or zero balance
  if (currentBalance <= 0) {
    return {
      runwayDays: 0,
      currentBalance,
      averageDailyExpense: Math.round(averageDailyExpense),
      estimatedExhaustionDate: null,
      subMessage:
        "Your expenses have exceeded your income during this period.",
    };
  }

  const runwayDays = Math.floor(
    currentBalance / averageDailyExpense
  );

  const estimatedExhaustionDate = new Date();
  estimatedExhaustionDate.setDate(
    estimatedExhaustionDate.getDate() + runwayDays
  );

  const formattedDate = estimatedExhaustionDate.toLocaleDateString(
    "en-IN",
    {
      day: "numeric",
      month: "short",
      year: "numeric",
    }
  );

  return {
    runwayDays,
    currentBalance,
    averageDailyExpense: Math.round(averageDailyExpense),
    estimatedExhaustionDate: formattedDate,
    subMessage: `At your current spending pace, remaining balance could last until ${formattedDate}.`,
  };
};

const getSavingsRateData = (
  totalIncome,
  totalExpenses
) => {
  if (!totalIncome || totalIncome <= 0) {
    return null;
  }

  const netBalance = totalIncome - totalExpenses;

  const savingsRate = Number(
    ((netBalance / totalIncome) * 100).toFixed(1)
  );

  let status = "";
  let subMessage = "";

  if (savingsRate < 0) {
    status = "Deficit";

    subMessage =
      "Your expenses exceed your income during this period.";
  } else if (savingsRate >= 50) {
    status = "Excellent";

    subMessage =
      "You are retaining more than half of your income. Strong financial discipline.";
  } else if (savingsRate >= 30) {
    status = "Good";

    subMessage =
      "You are saving a healthy portion of your income while managing expenses effectively.";
  } else if (savingsRate >= 10) {
    status = "Moderate";

    subMessage =
      "Your savings are positive, but reducing discretionary spending could improve your financial position.";
  } else {
    status = "Needs Attention";

    subMessage =
      "Most of your income is being spent. Consider reviewing your spending habits.";
  }

  return {
    savingsRate,
    netBalance,
    status,
    subMessage,
  };
};

const getIncomeDependencyData = (
  incomeRecords = []
) => {
  if (!Array.isArray(incomeRecords) || !incomeRecords.length) {
    return null;
  }

  const totalIncome = incomeRecords.reduce(
    (sum, income) =>
      sum + Number(income.incomeAmount || 0),
    0
  );

  if (totalIncome <= 0) {
    return null;
  }

  const sourceMap = {};

  incomeRecords.forEach((income) => {
    const source = income.incomeSource?.trim() || "Unknown";

    sourceMap[source] =
      (sourceMap[source] ?? 0) +
      Number(income.incomeAmount || 0);
  });

  const sortedSources = Object.entries(sourceMap).sort(
    (a, b) => b[1] - a[1]
  );

  const sourceCount = sortedSources.length;

  const [topSource, topAmount] = sortedSources[0];

  const secondSource =
    sortedSources.length > 1
      ? {
          name: sortedSources[1][0],
          amount: sortedSources[1][1],
        }
      : null;

  const dependencyPercent = Number(
    ((topAmount / totalIncome) * 100).toFixed(1)
  );

  let riskLevel = "";
  let subMessage = "";

  if (sourceCount === 1) {
    riskLevel = "Single Income Source";

    subMessage =
      "All income currently comes from one source. Building additional income streams could improve financial resilience.";
  } else if (dependencyPercent >= 80) {
    riskLevel = "High Dependency";

    subMessage =
      `You rely heavily on ${topSource}, which contributes ${dependencyPercent}% of your total income. Diversifying income sources could improve financial stability.`;
  } else if (dependencyPercent >= 50) {
    riskLevel = "Moderate Dependency";

    subMessage =
      `${topSource} contributes ${dependencyPercent}% of your income. Consider developing additional income streams to reduce reliance on a single source.`;
  } else {
    riskLevel = "Diversified";

    subMessage =
      "Your income is reasonably distributed across multiple sources, reducing dependency risk.";
  }

  return {
    topSource,
    topAmount: Math.round(topAmount),
    totalIncome: Math.round(totalIncome),
    dependencyPercent,
    sourceCount,
    secondSource,
    riskLevel,
    subMessage,
  };
};

module.exports = {
  getFinancialRunwayData, 
  getSavingsRateData,
  getIncomeDependencyData
}