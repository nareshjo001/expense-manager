const { createAnalyticsContext } = require("./analyticsContext");
const { assembleReport } = require("./reportAssembler");

const spendingAnalyzer = require("./analyzers/spendingAnalyzer");
const budgetAnalyzer = require("./analyzers/budgetAnalyzer");
const categoryAnalyzer = require("./analyzers/categoryAnalyzer");
const trendAnalyzer = require("./analyzers/trendAnalyzer");
const habitAnalyzer = require("./analyzers/habitAnalyzer");
const healthAnalyzer = require("./analyzers/healthAnalyzer");

const { generateBudgetInsights } = require('../Services/BudgetServices/budgetInsight.service');

const generateReport = async (userId) => {
  const analyticsContext = await createAnalyticsContext(userId);

  const spendingReport = spendingAnalyzer.analyze(analyticsContext.currentMonthExpenses);

  const budgetReport = budgetAnalyzer.analyze({
    history: analyticsContext.budgetHistory,
    spending: spendingReport,
    daysInMonth: analyticsContext.daysInMonth,
  });

  const budgetInsights = generateBudgetInsights(budgetReport);

  const monthlyCategoryReport = categoryAnalyzer.analyze(
      analyticsContext.currentMonthExpenses,
      analyticsContext.previousMonthExpenses
  );

  const yearlyCategoryReport = categoryAnalyzer.analyze(
      analyticsContext.currentYearExpenses,
      analyticsContext.previousYearExpenses
  );

  const trendReport = trendAnalyzer.analyze({
    trendData: analyticsContext.trendData,
    currentMonthExpenses: analyticsContext.currentMonthExpenses,
    previousMonthExpenses: analyticsContext.previousMonthExpenses,
  });

  const monthlyHabitReport = habitAnalyzer.analyze(analyticsContext.currentMonthExpenses);
  const yearlyHabitReport = habitAnalyzer.analyze(analyticsContext.currentYearExpenses);

  const healthReport = healthAnalyzer.analyze({
    budget: budgetReport,
    category: monthlyCategoryReport,
    spending: spendingReport,
    trend: trendReport,
    monthlyHabits: monthlyHabitReport,
  });

  const metadata = {
    version: 1,
    generatedAt: new Date().toISOString(),

    reportPeriod: {
      month: new Date().getMonth() + 1,
      year: new Date().getFullYear(),
    },

    lastExpenseUpdate: analyticsContext.lastExpenseUpdate ?? null,
    lastBudgetUpdate: analyticsContext.lastBudgetUpdate ?? null,
  };

  const summary = {
    totalSpent: spendingReport.totalSpent,
    transactionCount: spendingReport.transactionCount,
    dailyAverage: spendingReport.dailyAverage,
    comparePastMonth: trendReport.monthlyTrend.percentageChange,
    topCategory: monthlyCategoryReport.topCategory?.category ?? "N/A",

    budgetUtilization: budgetReport.utilization,
    budgetStatus: budgetReport.status,

    healthScore: healthReport.healthScore,
    riskLevel: healthReport.riskLevel,
  };

  return assembleReport({
    metadata,

    summary,

    spending: spendingReport,

    budgets: {
      ...budgetReport,
      budgetInsights
    },

    trends: trendReport,

    monthlyCategories: monthlyCategoryReport,
    yearlyCategories: yearlyCategoryReport,

    monthlyHabits: monthlyHabitReport,
    yearlyHabits: yearlyHabitReport,

    financialHealth: healthReport,

    forecast: {},

  });
};

module.exports = {
  generateReport,
};