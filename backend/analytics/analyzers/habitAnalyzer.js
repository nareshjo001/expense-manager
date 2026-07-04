const calculateWeekendVsWeekday = (expenses = []) => {
  let weekendSpent = 0;
  let weekdaySpent = 0;

  const weekendDays = new Set();
  const weekdayDays = new Set();

  for (const expense of expenses) {
    const amount = Number(expense.expenseAmount ?? 0);
    const date = new Date(expense.expenseDate);

    const day = date.getDay();
    const dateKey = date.toISOString().split("T")[0];

    if (day === 0 || day === 6) {
      weekendSpent += amount;
      weekendDays.add(dateKey);
    } else {
      weekdaySpent += amount;
      weekdayDays.add(dateKey);
    }
  }

  const weekendAverage =
    weekendSpent / Math.max(weekendDays.size, 1);

  const weekdayAverage =
    weekdaySpent / Math.max(weekdayDays.size, 1);

  let preferredPeriod = "Balanced";

  if (weekendAverage > weekdayAverage) {
    preferredPeriod = "Weekend";
  } else if (weekdayAverage > weekendAverage) {
    preferredPeriod = "Weekday";
  }

  return {
    weekendSpent,
    weekdaySpent,
    weekendAverage: Number(weekendAverage.toFixed(2)),
    weekdayAverage: Number(weekdayAverage.toFixed(2)),
    preferredPeriod,
    weekendRatio:
      weekdayAverage === 0
        ? null
        : Number((weekendAverage / weekdayAverage).toFixed(2))
  };
};

const calculateMicroSpending = (expenses = []) => {
  if (expenses.length < 5) {
    return {
      threshold: 0,
      transactionCount: 0,
      totalSpent: 0,
      averageAmount: 0,
      contributionPercentage: 0
    };
  }

  const totalSpent = expenses.reduce(
    (sum, expense) =>
      sum + Number(expense.expenseAmount ?? 0),
    0
  );

  const averageExpense = totalSpent / expenses.length;

  const threshold = Math.max(
    50,
    Math.round(averageExpense * 0.18)
  );

  const microExpenses = expenses.filter(
    expense =>
      Number(expense.expenseAmount ?? 0) <= threshold
  );

  const microSpent = microExpenses.reduce(
    (sum, expense) =>
      sum + Number(expense.expenseAmount ?? 0),
    0
  );

  return {
    threshold,
    transactionCount: microExpenses.length,
    totalSpent: microSpent,
    averageAmount:
      microExpenses.length === 0
        ? 0
        : Number(
            (microSpent / microExpenses.length).toFixed(2)
          ),
    contributionPercentage:
      totalSpent === 0
        ? 0
        : Number(
            ((microSpent / totalSpent) * 100).toFixed(2)
          )
  };
};

const calculateImpulseSpending = (expenses = []) => {
  const IMPULSE_CATEGORIES = new Set([
    "Shopping",
    "Entertainment",
    "Food",
    "Personal Care"
  ]);

  const impulseExpenses = expenses.filter(expense =>
    IMPULSE_CATEGORIES.has(expense.expenseCategory)
  );

  const amount = impulseExpenses.reduce(
    (sum, expense) =>
      sum + Number(expense.expenseAmount ?? 0),
    0
  );

  const categoryTotals = {};

  for (const expense of impulseExpenses) {
    categoryTotals[expense.expenseCategory] =
      (categoryTotals[expense.expenseCategory] || 0) +
      Number(expense.expenseAmount ?? 0);
  }

  let topImpulseCategory = null;
  let max = 0;

  for (const category in categoryTotals) {
    if (categoryTotals[category] > max) {
      max = categoryTotals[category];
      topImpulseCategory = category;
    }
  }

  return {
    transactionCount: impulseExpenses.length,
    totalSpent: amount,
    spendingPercentage:
      expenses.length === 0
        ? 0
        : Number(
            (
              (impulseExpenses.length /
                expenses.length) *
              100
            ).toFixed(2)
          ),
    topImpulseCategory
  };
};

const calculateSubscriptionPattern = (expenses = []) => {
  const subscriptions = expenses.filter(
    expense => expense.isRecurring
  );

  const monthlyCost = subscriptions.reduce(
    (sum, expense) =>
      sum + Number(expense.expenseAmount ?? 0),
    0
  );

  const highestSubscription =
    subscriptions.length === 0
      ? null
      : subscriptions.reduce((highest, current) =>
          Number(current.expenseAmount) >
          Number(highest.expenseAmount)
            ? current
            : highest
        );

  return {
    totalSubscriptions: subscriptions.length,
    monthlyCost,
    averageSubscription:
      subscriptions.length === 0
        ? 0
        : Number(
            (
              monthlyCost /
              subscriptions.length
            ).toFixed(2)
          ),
    highestSubscription,
    subscriptions
  };
};

const calculateShoppingFrequency = (expenses = []) => {
  const shoppingExpenses = expenses.filter(
    expense => expense.expenseCategory === "Shopping"
  );

  const shoppingDates = [
    ...new Set(
      shoppingExpenses
        .map(expense =>
          new Date(expense.expenseDate)
            .toISOString()
            .split("T")[0]
        )
    )
  ].sort();

  let totalGap = 0;

  for (let i = 1; i < shoppingDates.length; i++) {
    const previous = new Date(shoppingDates[i - 1]);
    const current = new Date(shoppingDates[i]);

    totalGap +=
      (current - previous) /
      (1000 * 60 * 60 * 24);
  }

  return {
    shoppingTransactions: shoppingExpenses.length,
    shoppingDays: shoppingDates.length,
    averageTransactionsPerShoppingDay:
      shoppingDates.length === 0
        ? 0
        : Number(
            (
              shoppingExpenses.length /
              shoppingDates.length
            ).toFixed(2)
          ),
    averageGapBetweenShoppingTrips:
      shoppingDates.length <= 1
        ? null
        : Number(
            (
              totalGap /
              (shoppingDates.length - 1)
            ).toFixed(2)
          )
  };
};

const analyze = (expenses = []) => {
  return {
    weekendVsWeekday:
      calculateWeekendVsWeekday(expenses),

    microSpending:
      calculateMicroSpending(expenses),

    impulseSpending:
      calculateImpulseSpending(expenses),

    subscriptionPattern:
      calculateSubscriptionPattern(expenses),

    shoppingFrequency:
      calculateShoppingFrequency(expenses)
  };
};

module.exports = {
  analyze
};