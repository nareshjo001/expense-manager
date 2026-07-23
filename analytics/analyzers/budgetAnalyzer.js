// Safely converts any value into a valid number
const toSafeNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

// Rounds a number to 2 decimal places
const round2 = (value) => Number(Number(value).toFixed(2));

// Calculates the budget utilization, remaining budget, and budget left percentage
const calculateBudgetUtilization = ({ budget = 0, spent = 0 } = {}) => {
  const safeBudget = toSafeNumber(budget);
  const safeSpent = toSafeNumber(spent);
  
  if (safeBudget <= 0) {
    return {
      hasBudget: false,
      utilization: null,
      remainingBudget: null,
      budgetLeft: null,
    }; 
  }

  const remainingBudget = round2(safeBudget - safeSpent);

  return {
    hasBudget: true,
    utilization: round2((safeSpent / safeBudget) * 100),
    remainingBudget,
    budgetLeft: round2((remainingBudget / safeBudget) * 100),
  };
};

// Calculates the budget status based on the budget and spent amounts
const STATUS_THRESHOLDS = [
  { max: 70, status: "Safe" },
  { max: 90, status: "Warning" },
  { max: 100, status: "Critical" },
  { max: Infinity, status: "Overspent" },
];

const calculateBudgetStatus = ({ budget = 0, spent = 0 } = {}) => {
  const safeBudget = toSafeNumber(budget);
  const safeSpent = toSafeNumber(spent);

  if (safeBudget <= 0) {
    return {
      isOverspent: safeSpent > 0,
      exceededBy: safeSpent > 0 ? round2(safeSpent) : 0,
      status: safeSpent > 0 ? "Overspent" : "NoBudgetSet",
    };
  }

  const utilization = (safeSpent / safeBudget) * 100;
  const isOverspent = safeSpent > safeBudget;
  const { status } = STATUS_THRESHOLDS.find((tier) => utilization <= tier.max);

  return {
    isOverspent,
    exceededBy: isOverspent ? round2(safeSpent - safeBudget) : 0,
    status,
  };
};

// Calculates the current budget streak based on the history of budget usage
const calculateBudgetStreak = (history = []) => {
  let currentStreak = 0;
  let longestStreak = 0;
  let running = 0;
  let stillCounting = true;
  let brokeOnMissingBudget = false; 

  if (!Array.isArray(history)) {
    return { currentStreak: 0, longestStreak: 0, streakBrokenReason: "INVALID_HISTORY" };
  }

  history.forEach((month) => {
    const monthBudget = toSafeNumber(month?.budget);
    const monthSpent = toSafeNumber(month?.spent);
    const budgetWasSet = monthBudget > 0;
    const withinBudget = budgetWasSet && monthSpent <= monthBudget;
 
    if (withinBudget) {
      running++;
      longestStreak = Math.max(longestStreak, running);
      if (stillCounting) currentStreak++;
    } else {
      running = 0;
      if (stillCounting && !budgetWasSet) brokeOnMissingBudget = true;
      stillCounting = false;
    }
  });

  return {
    currentStreak,
    longestStreak,
    streakBrokenReason: currentStreak === 0 && brokeOnMissingBudget ? "NO_BUDGET_THIS_MONTH" : null,
  };
};

// Calculates the projected budget usage and overspending based on the current spending rate
const calculateBudgetProjection = (
  { budget = 0, spent = 0 } = {},
  dailyAverage = 0,
  daysInMonth  = 30,
) => {
  const safeBudget = toSafeNumber(budget);
  const safeSpent = toSafeNumber(spent);
  const safeDailyAvg = toSafeNumber(dailyAverage);
  const safeDaysInMonth = toSafeNumber(daysInMonth, 30);

  if (safeDailyAvg <= 0 || safeDaysInMonth <= 0) {
    return {
      projectedSpent: round2(safeSpent),
      projectedOverspend: 0,
      projectedOverspendPercent: 0,
      daysUntilExhaustion: null,
      projectionReliable: false,
    };
  }

  const today = new Date();
  const daysElapsed = today.getDate();

  const projectedSpent =
    daysElapsed && daysElapsed > 0
      ? safeSpent + safeDailyAvg * Math.max(0, safeDaysInMonth - daysElapsed)
      : safeDailyAvg * safeDaysInMonth;

  const projectedOverspend = Math.max(0, projectedSpent - safeBudget)
  const projectedOverspendPercent = safeBudget > 0 ? round2((projectedOverspend / safeBudget) * 100) : 0;

  let daysUntilExhaustion = null;

  if (safeBudget > 0) {
    daysUntilExhaustion = safeSpent >= safeBudget ? 0 : Math.floor((safeBudget - safeSpent) / safeDailyAvg);
  }

  return {
    projectedSpent: round2(projectedSpent),
    projectedOverspend: round2(projectedOverspend),
    projectedOverspendPercent,
    daysUntilExhaustion,
    projectionReliable: true,
  };
};

// Analyzes the budget data and returns a comprehensive report including utilization, status, streaks, and projections
const analyze = ({
  history = [],
  spending = {},
  daysInMonth = 30,
}) => {
  if (!Array.isArray(history) || history.length === 0) {
    return { hasData: false };
  }

  const currentMonth = history[0] || { budget: 0, spent: 0 };

  return {
    hasData: true,
    ...calculateBudgetUtilization(currentMonth),
    ...calculateBudgetStatus(currentMonth),
    ...calculateBudgetStreak(history),
    ...calculateBudgetProjection(currentMonth, spending.dailyAverage, daysInMonth),
  };
};

module.exports = {
  calculateBudgetUtilization,
  calculateBudgetStatus,
  calculateBudgetStreak,
  calculateBudgetProjection,
  analyze,
}; 