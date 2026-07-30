// Centralized query-key factory so components never hand-write cache keys.
export const queryKeys = {
  reports: {
    all: ["reports"],
  },

  expenses: {
    all: ["expenses"],
    lists: () => [...queryKeys.expenses.all, "list"],
    list: (filters) => [...queryKeys.expenses.lists(), filters],
    detail: (expenseId) => [
      ...queryKeys.expenses.all,
      "detail",
      expenseId,
    ],
  },

  budgets: {
    all: ["budgets"],
  },

  income: {
    all: ["income"],
    list: () => [...queryKeys.income.all, "list"],
    summary: (period) => [
      ...queryKeys.income.all,
      "summary",
      period,
    ],
    insights: (period) => [
      ...queryKeys.income.all,
      "insights",
      period,
    ],
  },

  charts: {
    all: ["charts"],
    bar: (filters) => [
      ...queryKeys.charts.all,
      "bar",
      filters,
    ],
    trend: (filters) => [
      ...queryKeys.charts.all,
      "trend",
      filters,
    ],
    loggedYears: () => [
      ...queryKeys.charts.all,
      "logged-years",
    ],
    pie: (filters) => [
      ...queryKeys.charts.all,
      "pie",
      filters,
    ],
  },
};
