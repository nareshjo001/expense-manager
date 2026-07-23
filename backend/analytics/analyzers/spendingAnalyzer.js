const toSafeNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};
 
const round2 = (value) => Number(Number(value).toFixed(2));
 
const MS_PER_DAY = 1000 * 60 * 60 * 24;

const parseDate = (value) => {
  const date = new Date(value);
  
  return Number.isNaN(date.getTime()) ? null : date;
};

// Calculates basic statistics for the current month's expenses, including total spent, transaction count, largest and smallest expenses
const calculateBasicStats = (currentMonthExpenses) => {
  const list = Array.isArray(currentMonthExpenses) ? currentMonthExpenses : [];

  let totalSpent = 0;
  let totalRefunds = 0;
  let largestExpense = null;
  let smallestExpense = null;
 
  for (const expense of list) {
    const amount = toSafeNumber(expense?.expenseAmount);
    totalSpent += amount;
 
    if (amount < 0) {
      // A refund isn't an "expense" — don't let it win largest/smallest.
      totalRefunds += Math.abs(amount);
      continue;
    }
 
    if (largestExpense === null || amount > toSafeNumber(largestExpense.expenseAmount)) {
      largestExpense = expense;
    }
    if (smallestExpense === null || amount < toSafeNumber(smallestExpense.expenseAmount)) {
      smallestExpense = expense;
    }
  }
 
  return {
    totalSpent: round2(totalSpent),
    totalRefunds: round2(totalRefunds),
    transactionCount: list.length,
    largestExpense,
    smallestExpense,
  };
};

// Calculates time-based statistics for the current month's expenses, including tracking days, tracking weeks, daily average, and weekly average
const calculateTimeStatistics = (currentMonthExpenses = [], totalSpent = 0, options = {}) => {
  const list = Array.isArray(currentMonthExpenses) ? currentMonthExpenses : [];
  const asOfDate = options.asOfDate instanceof Date ? options.asOfDate : new Date();

  if (!list.length) {
    return { 
      trackingDays: 0, 
      trackingWeeks: 0, 
      dailyAverage: 0, 
      weeklyAverage: 0, 
      periodStart: null 
    };
  }

  const validDates = list.map((e) => parseDate(e?.expenseDate)).filter(Boolean);
  
  if (!validDates.length) {
    return {
      trackingDays: 0,
      trackingWeeks: 0,
      dailyAverage: 0,
      weeklyAverage: 0,
      periodStart: null,
      dataQualityWarning: "NO_VALID_EXPENSE_DATES",
    };
  }

  const periodStart =
    options.periodStart instanceof Date
      ? options.periodStart
      : new Date(Math.min(...validDates.map((d) => d.getTime())));

  const start = new Date(periodStart);
  start.setHours(0, 0, 0, 0);

  const end = new Date(asOfDate);
  end.setHours(0, 0, 0, 0);

  const trackingDays = Math.floor((end - start) / MS_PER_DAY) + 1;

  const trackingWeeks = Math.max(1, trackingDays / 7);

  return {
    trackingDays,
    trackingWeeks: round2(trackingWeeks),
    dailyAverage: round2(totalSpent / trackingDays),
    weeklyAverage: round2(totalSpent / trackingWeeks),
    periodStart,
  };
};

/**
 * Coefficient of variation of WEEKLY spend totals — see spendingRules.js
 * header comment for why weekly (not daily) buckets are used, and the
 * known limitation around legitimate large recurring expenses.
 */
const calculateSpendingStability = (expenses = [], options = {}) => {
  const list = Array.isArray(expenses) ? expenses : [];
  const asOfDate = options.asOfDate instanceof Date ? options.asOfDate : new Date();
 
  const validEntries = list
    .map((e) => ({ date: parseDate(e?.expenseDate), amount: toSafeNumber(e?.expenseAmount) }))
    .filter((e) => e.date && e.amount > 0); // refunds excluded from volatility calc
 
  if (!validEntries.length) {
    return { 
      coefficientOfVariation: null, 
      weeklyTotals: [], 
      reason: "NO_VALID_DATA" 
    };
  }
 
  const periodStart =
    options.periodStart instanceof Date
      ? options.periodStart
      : new Date(Math.min(...validEntries.map((e) => e.date.getTime())));
 
  const trackingDays = Math.max(1, Math.ceil((asOfDate - periodStart) / MS_PER_DAY) + 1);
 
  if (trackingDays < 14) {
    return { 
      coefficientOfVariation: null, 
      weeklyTotals: [], 
      reason: "INSUFFICIENT_TRACKING_DAYS" 
    };
  }
 
  const weekCount = Math.ceil(trackingDays / 7);
  const weeklyTotals = new Array(weekCount).fill(0);
 
  validEntries.forEach(({ date, amount }) => {
    const dayOffset = Math.floor((date - periodStart) / MS_PER_DAY);
    const weekIndex = Math.min(weekCount - 1, Math.max(0, Math.floor(dayOffset / 7)));
    weeklyTotals[weekIndex] += amount;
  });
 
  const mean = weeklyTotals.reduce((sum, v) => sum + v, 0) / weeklyTotals.length;
 
  if (mean === 0) {
    return { 
      coefficientOfVariation: null, 
      weeklyTotals, 
      reason: "NO_SPEND_IN_PERIOD" 
    };
  }
 
  const variance = weeklyTotals.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / weeklyTotals.length;
  const stdDev = Math.sqrt(variance);
 
  return {
    coefficientOfVariation: round2(stdDev / mean),
    weeklyTotals: weeklyTotals.map(round2),
    reason: null,
  };
};

// Analyzes the current month's expenses and returns a comprehensive report including basic statistics and time-based statistics
const analyze = (currentMonthExpenses = [], options = {}) => {
  const list = Array.isArray(currentMonthExpenses) ? currentMonthExpenses : [];
 
  if (!list.length) {
    return { hasData: false };
  }
 
  const basicStats = calculateBasicStats(list);
  const timeStats = calculateTimeStatistics(list, basicStats.totalSpent, options);
  const stability = calculateSpendingStability(list, options);
 
  return {
    hasData: true,
    ...basicStats,
    ...timeStats,
    stability,
  };
};
 
module.exports = {
  calculateBasicStats,
  calculateTimeStatistics,
  calculateSpendingStability,
  analyze,
};