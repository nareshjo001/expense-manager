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
const currentMonthForecastAnalyzer = require("./analyzers/currentMonthForecastAnalyzer");
const habitRules = require("./analyzers/scores/habitRules");
const weeklyChangeAnalyzer = require("./analyzers/weeklyChangeAnalyzer");
const categoryPatternAnalyzer = require("./analyzers/categoryPatternAnalyzer");
const stabilityScoreAnalyzer = require("./analyzers/stabilityScoreAnalyzer");
const chartFindingsAnalyzer = require("./analyzers/chartFindingsAnalyzer");
const { CURRENT_REPORT_VERSION } = require("./reportContractVersion");

const { generateBudgetInsights } = require('../Services/BudgetServices/budgetInsight.service');

const generateReport = async (userId) => {
  // One immutable timestamp keeps every date-dependent report section in
  // the same calendar month, even when generation crosses midnight.
  const analysisDate = new Date();
  const analyticsContext = await createAnalyticsContext(userId, { analysisDate });

  const spendingReport = spendingAnalyzer.analyze(analyticsContext.currentMonthExpenses);

  const budgetReport = budgetAnalyzer.analyze({
    history: analyticsContext.budgetHistory,
    spending: spendingReport,
    daysInMonth: analyticsContext.daysInMonth,
    asOfDate: analysisDate,
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
  const anomalyReport = expenseAnomalyAnalyzer.analyze({
    currentMonthExpenses: analyticsContext.currentMonthExpenses,
    recentExpensePool: analyticsContext.recentExpensePool,
    currentMonthStart: analyticsContext.currentMonthStart,
    monthlyReferenceAmount: budgetReport.hasBudget === true ? budgetReport.budget : null,
  });

  // Forecasting V2: pure, deterministic, explicitly-statistical analyzer.
  const retainedForecastReport = forecastAnalyzer.analyze({
    monthlySeries: analyticsContext.forecastMonthlySeries,
    currentPartialMonthTotal: analyticsContext.forecastCurrentPartialMonthTotal,
    currentMonthStart: analyticsContext.currentMonthStart,
    categorySeries: analyticsContext.forecastCategorySeries,
    activeDays: analyticsContext.forecastActiveDays,
    targetMonthBudget: analyticsContext.forecastTargetMonthBudget,
  });
  const currentMonthForecast = await currentMonthForecastAnalyzer.analyze({
    input: analyticsContext.currentMonthForecastInput,
    currentMonthStart: analyticsContext.currentMonthStart,
    currentMonthBudget: analyticsContext.forecastCurrentMonthBudget,
  });

  // Backward compatible: every existing horizon remains byte-for-byte under
  // its original key. The redesigned UI reads only this added field.
  const forecastReport = {
    ...retainedForecastReport,
    currentMonthForecast,
  };

  // ANL-001-T03: deterministic facts the frontend previously recalculated
  // itself (ANL-001-T01 mapping, ANL-001-T02 contract). Each analyzer is
  // pure and reuses an already-computed upstream report rather than
  // requerying the database.
  const weeklyChangeReport = weeklyChangeAnalyzer.analyze({
    currentWeekExpenses: analyticsContext.trendData.currentWeek,
    previousWeekExpenses: analyticsContext.trendData.previousWeek,
    stability: spendingReport.stability,
  });

  const categoryPatternReport = categoryPatternAnalyzer.analyze({
    monthlyCategoryReport,
    yearlyCategoryReport,
    currentMonthExpenses: analyticsContext.currentMonthExpenses,
  });

  const stabilityScoreReport = stabilityScoreAnalyzer.analyze({
    stability: spendingReport.stability,
  });

  const chartFindingsReport = chartFindingsAnalyzer.analyze({
    trendReport,
    budgetReport,
    categoryReport: monthlyCategoryReport,
  });

  const insightsReport = {
    weeklyChange: weeklyChangeReport,
    categoryPattern: categoryPatternReport,
    stability: stabilityScoreReport,
    chartFindings: chartFindingsReport,
  };

  const metadata = {
    // Stamped from the single shared constant so reportService.js's
    // isCurrentReport() check and this generator can never drift apart.
    version: CURRENT_REPORT_VERSION,
    generatedAt: analysisDate.toISOString(),

    reportPeriod: {
      month: analysisDate.getMonth() + 1,
      year: analysisDate.getFullYear(),
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

    // ANL-001-T02/T03: healthScore/riskLevel removed -- healthAnalyzer.analyze()
    // has always returned `overall`/`risk`, never `healthScore`/`riskLevel`, so
    // these two fields were undefined in every real response. financialHealth.overall
    // and financialHealth.risk (below) are the real, populated values; read those.
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

    insights: insightsReport,

  });
};

module.exports = {
  generateReport,
};
