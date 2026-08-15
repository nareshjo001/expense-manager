const toSafeNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};
 
const round2 = (value) => Number(Number(value).toFixed(2));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
 
const CLAMP_RANGE = 200; // percent — bounds any single period's influence on the composite score
const NEW_SPENDING_SIGNAL = 150; // surrogate signal strength for "started spending from zero"

const getTotalSpent = (expenses = []) => {
  const list = Array.isArray(expenses) ? expenses : [];
  
  return round2(list.reduce((sum, expense) => sum + toSafeNumber(expense?.expenseAmount), 0));
};

// Compares two periods of expenses and returns the total spent, amount change, percentage change, and direction of change
const comparePeriods = (currentExpenses = [], previousExpenses = []) => {
  const current = getTotalSpent(currentExpenses);
  const previous = getTotalSpent(previousExpenses);
  const amountChange = round2(current - previous);
 
  let percentageChange = 0;
  let isNewSpending = false;
 
  if (previous === 0) {
    if (current > 0) {
      // % change from a zero baseline is undefined (division by zero), not "100%" -- report null so the UI says "new spending of ₹X" instead of a fabricated percentage.
      percentageChange = null;
      isNewSpending = true;
    }
    // previous === 0 && current === 0 -> genuinely no change, stays 0
  } else {
    percentageChange = round2((amountChange / previous) * 100);
  }
 
  return {
    current,
    previous,
    amountChange,
    percentageChange,
    isNewSpending,
    direction: amountChange > 0 ? "up" : amountChange < 0 ? "down" : "same",
  };
};

// Converts a trend into a bounded signal safe for weighted averaging -- raw percentageChange is unbounded (a tiny `previous` can compute as a 49,900% "increase") and would otherwise dominate the composite score.
const getScoringSignal = (trend) => {
  if (trend.isNewSpending) return NEW_SPENDING_SIGNAL;
  if (trend.percentageChange === null) return 0;
  return clamp(trend.percentageChange, -CLAMP_RANGE, CLAMP_RANGE);
};
 
const TREND_WEIGHTS = { daily: 1, weekly: 2, monthly: 3, quarterly: 4 };

// Calculates the overall spending direction based on weighted trends across different periods
const calculateSpendingDirection = ({ dailyTrend, weeklyTrend, monthlyTrend, quarterlyTrend }) => {
  const totalWeight = TREND_WEIGHTS.daily + TREND_WEIGHTS.weekly + TREND_WEIGHTS.monthly + TREND_WEIGHTS.quarterly;
 
  const weightedSum =
    getScoringSignal(dailyTrend) * TREND_WEIGHTS.daily +
    getScoringSignal(weeklyTrend) * TREND_WEIGHTS.weekly +
    getScoringSignal(monthlyTrend) * TREND_WEIGHTS.monthly +
    getScoringSignal(quarterlyTrend) * TREND_WEIGHTS.quarterly;
 
  const strength = round2(weightedSum / totalWeight);
 
  let direction = "Stable";
  if (strength > 15) direction = "Increasing";
  else if (strength < -15) direction = "Decreasing";
 
  return { direction, strength };
};
 
const analyze = ({ trendData = {}, currentMonthExpenses = [], previousMonthExpenses = [] } = {}) => {
  const dailyTrend = comparePeriods(trendData.today, trendData.yesterday);
  const weeklyTrend = comparePeriods(trendData.currentWeek, trendData.previousWeek);
  const monthlyTrend = comparePeriods(currentMonthExpenses, previousMonthExpenses);
  const quarterlyTrend = comparePeriods(trendData.currentQuarter, trendData.previousQuarter);
 
  const noActivity = [dailyTrend, weeklyTrend, monthlyTrend, quarterlyTrend].every(
    (t) => t.current === 0 && t.previous === 0
  );
 
  if (noActivity) {
    // Zero spend in every window (new user or data gap) -- "Stable" would be technically true but misleading; let the score layer decide how to represent it.
    return { hasData: false, dailyTrend, weeklyTrend, monthlyTrend, quarterlyTrend };
  }
 
  const { direction, strength } = calculateSpendingDirection({
    dailyTrend,
    weeklyTrend,
    monthlyTrend,
    quarterlyTrend,
  });
 
  return {
    hasData: true,
    dailyTrend,
    weeklyTrend,
    monthlyTrend,
    quarterlyTrend,
    spendingDirection: direction,
    spendingDirectionStrength: strength,
  };
};

module.exports = {
  comparePeriods,
  getTotalSpent,
  calculateSpendingDirection,
  analyze,
};