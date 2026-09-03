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

  // CAT-001 -- saved merchant category rules.
  merchantRules: {
    all: ["merchantRules"],
  },

  income: {
    all: ["income"],
    list: (period) => [...queryKeys.income.all, "list", period ?? "all"],
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

  sia: {
    all: ["sia"],
    // Batch 3E: runtime availability (GET /sia/status). A stable, argument-
    status: () => [...queryKeys.sia.all, "status"],
    sessions: {
      all: () => [...queryKeys.sia.all, "sessions"],
      list: () => [...queryKeys.sia.sessions.all(), "list"],
      messages: (sessionId) => [
        ...queryKeys.sia.sessions.all(),
        "messages",
        sessionId,
      ],
    },
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
