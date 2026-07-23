const { createAnalyticsContext } = require("./analyticsContext");

const spendingAnalyzer = require("./analyzers/spendingAnalyzer");
const budgetAnalyzer = require("./analyzers/budgetAnalyzer");
const categoryAnalyzer = require("./analyzers/categoryAnalyzer");
const trendAnalyzer = require("./analyzers/trendAnalyzer");

const habitAnalyzer = require("./analyzers/habitAnalyzer");

const healthAnalyzer = require("./analyzers/healthAnalyzer");

const spendingScore = require("./analyzers/scoreCal/spendingScore");
const budgetScore = require("./analyzers/scoreCal/budgetScore");
const categoryScore = require("./analyzers/scoreCal/categoryScore");
const trendScore = require("./analyzers/scoreCal/trendScore");

const generateReport = async (userId) => {
  const analyticsContext = await createAnalyticsContext(userId);

  const spendingReport = spendingAnalyzer.analyze(analyticsContext.currentMonthExpenses);

  const budgetReport = budgetAnalyzer.analyze({
    history: analyticsContext.budgetHistory,
    spending: spendingReport,
    daysInMonth: analyticsContext.daysInMonth,
  });

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

  // console.log(monthlyCategoryReport);
  // console.log(yearlyCategoryReport);

  // console.log(spendingReport);
  // console.log(budgetReport);

  // console.log(trendReport);

  // console.log(monthlyHabitReport);
  // console.log(yearlyHabitReport);

  // console.log("Spending Score:", spendingScore.calculateSpendingScore(spendingReport));
  // console.log("Budget Score:", budgetScore.calculateBudgetScore(budgetReport));
  // console.log("Monthly Category Score:", categoryScore.calculateCategoryScore(monthlyCategoryReport));
  // console.log("Yearly Category Score:", categoryScore.calculateCategoryScore(yearlyCategoryReport));
  // console.log("Trend Score:", trendScore.calculateTrendScore(trendReport));

  // const healthReport = healthAnalyzer.analyze({
  //   spending: spendingReport,
  //   budget: budgetReport,
  //   trend: trendReport,
  //   monthlyCategories: monthlyCategoryReport,
  //   yearlyCategories: yearlyCategoryReport,
  //   monthlyHabits: monthlyHabitReport,
  //   yearlyHabits: yearlyHabitReport,
  // });

  // console.log(healthReport);

  return {
    spending: spendingReport,
    budget: budgetReport,
    monthlyCategories: monthlyCategoryReport,
    yearlyCategories: yearlyCategoryReport,
    trend: trendReport,
    monthlyHabits: monthlyHabitReport,
    yearlyHabits: yearlyHabitReport,
    // health: healthReport,
  };
};

module.exports = {
  generateReport,
};