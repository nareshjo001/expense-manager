const { createAnalyticsContext } = require("./analyticsContext");
const { assembleReport } = require("./reportAssembler");

const spendingAnalyzer = require("./analyzers/spendingAnalyzer");
const budgetAnalyzer = require("./analyzers/budgetAnalyzer");
const categoryAnalyzer = require("./analyzers/categoryAnalyzer");
const trendAnalyzer = require("./analyzers/trendAnalyzer");
const habitAnalyzer = require("./analyzers/habitAnalyzer");
const healthAnalyzer = require("./analyzers/healthAnalyzer");
const expenseAnomalyAnalyzer = require("./analyzers/expenseAnomalyAnalyzer");
const forecastAnalyzer = require("./analyzers/forecastAnalyzer");
const riskAnalyzer = require("./analyzers/riskAnalyzer");
const habitRules = require("./analyzers/scores/habitRules");
const { CURRENT_REPORT_VERSION } = require("./reportContractVersion");

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

  const monthlyHabitReport = habitAnalyzer.analyze(analyticsContext.currentMonthExpenses, habitRules.habits);
  const yearlyHabitReport = habitAnalyzer.analyze(analyticsContext.currentYearExpenses, habitRules.habits);

  const healthReport = healthAnalyzer.analyze({
    budget: budgetReport,
    category: monthlyCategoryReport,
    spending: spendingReport,
    trend: trendReport,
    habits: monthlyHabitReport,
  });

  // Anomaly detection V1: pure analyzer, fed only provider/context data
  // (never raw DB access, never SIA/LLM). recentExpensePool and
  // currentMonthStart are both already computed by analyticsContext.
  const anomalyReport = expenseAnomalyAnalyzer.analyze({
    currentMonthExpenses: analyticsContext.currentMonthExpenses,
    recentExpensePool: analyticsContext.recentExpensePool,
    currentMonthStart: analyticsContext.currentMonthStart,
  });

  // Forecasting V2: pure, deterministic, explicitly-statistical analyzer.
  // Architecture-closure correction: forecastAnalyzer.js is deliberately
  // NOT given recentExpensePool/currentMonthExpenses (transaction-shaped,
  // includes _id/expenseName/expenseCategory/userId) -- only the bounded,
  // aggregate-only series analyticsContext.js's forecastInputAggregator.js
  // boundary already computed. No new database query either way. Never a
  // trained model, never a fabricated accuracy figure (see
  // analytics/analyzers/scores/forecastRules.js).
  const forecastReport = forecastAnalyzer.analyze({
    monthlySeries: analyticsContext.forecastMonthlySeries,
    currentPartialMonthTotal: analyticsContext.forecastCurrentPartialMonthTotal,
    currentMonthStart: analyticsContext.currentMonthStart,
  });

  // Risk Intelligence V1: pure, deterministic analyzer consuming only
  // already-computed report sections (never raw collections, never the
  // LLM). A forecast that is unavailable/insufficient does not invalidate
  // the rest of risk -- riskAnalyzer.js simply skips the one
  // forecast-dependent signal in that case.
  const riskReport = riskAnalyzer.analyze({
    spending: spendingReport,
    budgets: budgetReport,
    trends: trendReport,
    financialHealth: healthReport,
    anomalies: anomalyReport,
    forecast: forecastReport,
  });

  const metadata = {
    // Stamped from the single shared constant so reportService.js's
    // isCurrentReport() check and this generator can never drift apart.
    version: CURRENT_REPORT_VERSION,
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

    forecast: forecastReport,

    anomalies: anomalyReport,

    risk: riskReport,

  });
};

module.exports = {
  generateReport,
};