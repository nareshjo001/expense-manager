const assembleReport = ({
  metadata,
  summary,
  spending,
  budgets,
  trends,
  monthlyCategories,
  yearlyCategories,
  monthlyHabits,
  yearlyHabits,
  financialHealth,
  forecast = {},
  anomalies = {},
  insights = {},
}) => {
  return {
    metadata,

    summary,

    spending,

    budgets,

    categories: {
      monthly: monthlyCategories,
      yearly: yearlyCategories,
    },

    trends,

    habits: {
      monthly: monthlyHabits,
      yearly: yearlyHabits,
    },

    financialHealth,

    forecast,

    anomalies,

    insights,
  };
};

module.exports = {
  assembleReport,
};
