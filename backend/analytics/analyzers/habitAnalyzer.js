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
 
const toLocalDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};
 
const median = (numbers = []) => {
  if (!numbers.length) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : round2((sorted[mid - 1] + sorted[mid]) / 2);
};
 
const calculateWeekendVsWeekday = (expenses = []) => {
  const list = Array.isArray(expenses) ? expenses : [];

  const minimumSample = 6;

  if (list.length < minimumSample) {
    return {
      hasData: false,
      reason: "InsufficientData",
      weekendSpent: null,
      weekdaySpent: null,
      weekendAverage: null,
      weekdayAverage: null,
      preferredPeriod: "InsufficientData",
      weekendRatio: null,
    };
  }
 
  let weekendSpent = 0;
  let weekdaySpent = 0;
  const weekendDays = new Set();
  const weekdayDays = new Set();
 
  for (const expense of list) {
    const date = parseDate(expense?.expenseDate);
    if (!date) continue; // skip malformed dates instead of crashing or miscounting
 
    const amount = toSafeNumber(expense?.expenseAmount);
    const day = date.getDay();
    const dateKey = toLocalDateKey(date);
 
    if (day === 0 || day === 6) {
      weekendSpent += amount;
      weekendDays.add(dateKey);
    } else {
      weekdaySpent += amount;
      weekdayDays.add(dateKey);
    }
  }
 
  const hasWeekendData = weekendDays.size > 0;
  const hasWeekdayData = weekdayDays.size > 0;
 
  // null (not 0) when a bucket has no data at all — 0 would look like
  // "confirmed zero spending," which is a different, stronger claim
  // than "we have no weekend transactions to measure."
  const weekendAverage = hasWeekendData ? round2(weekendSpent / weekendDays.size) : null;
  const weekdayAverage = hasWeekdayData ? round2(weekdaySpent / weekdayDays.size) : null;
 
  let preferredPeriod = "InsufficientData";
  if (hasWeekendData && hasWeekdayData) {
    if (weekendAverage > weekdayAverage) preferredPeriod = "Weekend";
    else if (weekdayAverage > weekendAverage) preferredPeriod = "Weekday";
    else preferredPeriod = "Balanced";
  }
 
  return {
    weekendSpent: round2(weekendSpent),
    weekdaySpent: round2(weekdaySpent),
    weekendAverage,
    weekdayAverage,
    preferredPeriod,
    weekendRatio:
      !hasWeekendData || !hasWeekdayData || weekdayAverage === 0
        ? null
        : round2(weekendAverage / weekdayAverage),
  };
};
 
const calculateMicroSpending = (expenses = [], config = {}) => {
  const list = Array.isArray(expenses) ? expenses : [];
  const minSample = config.minimumSampleSize ?? 5;
  const floorAmount = config.floorAmount ?? 50;
  const medianMultiplier = config.medianMultiplier ?? 0.18;
 
  if (list.length < minSample) {
    return {
      hasData: false,
      threshold: null,
      transactionCount: 0,
      totalSpent: 0,
      averageAmount: 0,
      contributionPercentage: null,
    };
  }
 
  const amounts = list.map((e) => toSafeNumber(e?.expenseAmount)).filter((a) => a >= 0);
  const totalSpent = round2(amounts.reduce((sum, a) => sum + a, 0));
 
  const medianExpense = median(amounts);
  const threshold = Math.max(floorAmount, Math.round(medianExpense * medianMultiplier));
 
  const microExpenses = list.filter((e) => {
    const amount = toSafeNumber(e?.expenseAmount);
    return amount > 0 && amount <= threshold;
  });
  
  const microSpent = round2(
    microExpenses.reduce(
      (sum, e) => sum + toSafeNumber(e?.expenseAmount),
      0
    )
  );

  // Calculate this BEFORE using it
  const contributionPercentage =
    totalSpent === 0
      ? 0
      : round2((microSpent / totalSpent) * 100);

  const qualifies =
    microExpenses.length >= 5 &&
    microSpent >= 300 &&
    contributionPercentage >= 10;

  return {
    hasData: true,
    threshold,
    transactionCount: microExpenses.length,
    totalSpent: microSpent,
    averageAmount:
      microExpenses.length === 0
        ? 0
        : round2(microSpent / microExpenses.length),
    contributionPercentage,
    qualifies,
  };
};
 
const calculateImpulseSpending = (expenses = [], config = {}) => {
  const list = Array.isArray(expenses) ? expenses : [];
  const impulseCategories = new Set(config.categories ?? []);
 
  const impulseExpenses = list.filter((e) => impulseCategories.has(e?.expenseCategory));
 
  const totalSpent = round2(list.reduce((sum, e) => sum + toSafeNumber(e?.expenseAmount), 0));
  const impulseAmount = round2(
    impulseExpenses.reduce((sum, e) => sum + toSafeNumber(e?.expenseAmount), 0)
  );
 
  const categoryTotals = {};
  for (const expense of impulseExpenses) {
    const category = expense?.expenseCategory;
    categoryTotals[category] = round2(
      (categoryTotals[category] || 0) + toSafeNumber(expense?.expenseAmount)
    );
  }
 
  let topImpulseCategory = null;
  let max = -Infinity;
  for (const category in categoryTotals) {
    if (categoryTotals[category] > max) {
      max = categoryTotals[category];
      topImpulseCategory = category;
    }
  }
 
  return {
    transactionCount: impulseExpenses.length,
    totalSpent: impulseAmount,
    // Two different questions, kept separate on purpose: how much of
    // your ACTIVITY is impulse-category vs how much of your MONEY is.
    // A user with many small impulse buys and one huge rent payment
    // would look very different on these two numbers.
    transactionSharePercentage:
      list.length === 0 ? 0 : round2((impulseExpenses.length / list.length) * 100),
    amountSharePercentage: totalSpent === 0 ? 0 : round2((impulseAmount / totalSpent) * 100),
    topImpulseCategory,
  };
};
 
const calculateSubscriptionPattern = (expenses = []) => {
  const list = Array.isArray(expenses) ? expenses : [];
  const subscriptions = list.filter((e) => e?.isRecurring);
 
  const periodCost = round2(
    subscriptions.reduce((sum, e) => sum + toSafeNumber(e?.expenseAmount), 0)
  );
 
  const highestSubscription =
    subscriptions.length === 0
      ? null
      : subscriptions.reduce((highest, current) =>
          toSafeNumber(current?.expenseAmount) > toSafeNumber(highest?.expenseAmount)
            ? current
            : highest
        );
 
  // Grouped by name/category instead of returning the raw expense
  // array — more directly useful ("Netflix: ₹500, Spotify: ₹199") and
  // avoids handing back full transaction records where a summary will do.
  const subscriptionsBreakdown = {};
  for (const sub of subscriptions) {
    const key = sub?.expenseName || sub?.expenseCategory || "Unknown";
    subscriptionsBreakdown[key] = round2(
      (subscriptionsBreakdown[key] || 0) + toSafeNumber(sub?.expenseAmount)
    );
  }
 
  return {
    totalSubscriptions: subscriptions.length,
    periodCost,
    averageSubscription: subscriptions.length === 0 ? 0 : round2(periodCost / subscriptions.length),
    highestSubscription,
    subscriptionsBreakdown,
  };
};
 
const calculateShoppingFrequency = (expenses = []) => {
  const list = Array.isArray(expenses) ? expenses : [];
  const shoppingExpenses = list.filter((e) => e?.expenseCategory === "Shopping");
 
  const shoppingDates = [
    ...new Set(
      shoppingExpenses
        .map((e) => parseDate(e?.expenseDate))
        .filter(Boolean)
        .map(toLocalDateKey)
    ),
  ].sort();
 
  let totalGap = 0;
  for (let i = 1; i < shoppingDates.length; i++) {
    const previous = new Date(shoppingDates[i - 1]);
    const current = new Date(shoppingDates[i]);
    totalGap += (current - previous) / MS_PER_DAY;
  }
 
  return {
    shoppingTransactions: shoppingExpenses.length,
    shoppingDays: shoppingDates.length,
    averageTransactionsPerShoppingDay:
      shoppingDates.length === 0 ? 0 : round2(shoppingExpenses.length / shoppingDates.length),
    averageGapBetweenShoppingTrips:
      shoppingDates.length <= 1 ? null : round2(totalGap / (shoppingDates.length - 1)),
  };
};
 
/**
 * @param {Array} expenses
 * @param {{microSpending?: object, impulseSpending?: object}} config - passed through to sub-calculators
 */
const analyze = (expenses = [], config = {}) => {
  const list = Array.isArray(expenses) ? expenses : [];
 
  if (!list.length) {
    return { hasData: false };
  }
 
  return {
    hasData: true,
    weekendVsWeekday: calculateWeekendVsWeekday(list),
    microSpending: calculateMicroSpending(list, config.microSpending),
    impulseSpending: calculateImpulseSpending(list, config.impulseSpending),
    subscriptionPattern: calculateSubscriptionPattern(list),
    shoppingFrequency: calculateShoppingFrequency(list),
  };
};
 
module.exports = {
  calculateWeekendVsWeekday,
  calculateMicroSpending,
  calculateImpulseSpending,
  calculateSubscriptionPattern,
  calculateShoppingFrequency,
  analyze,
};
