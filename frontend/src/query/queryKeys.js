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

  // REC-002-T05 -- recurring-definition lifecycle management (list/detail).
  // Deliberately separate from the REC-003 upcoming projection, which is
  // fetched by UpcomingRecurring.js outside TanStack Query entirely -- this
  // key namespace is only for the definitions themselves.
  recurring: {
    all: ["recurring"],
    lists: () => [...queryKeys.recurring.all, "list"],
    detail: (id) => [...queryKeys.recurring.all, "detail", id],
  },

  // NOT-003-T02 -- notification type/quiet-hours preferences. One document
  // per user, so no list/detail split like recurring -- just a single key.
  notificationPreferences: {
    all: ["notificationPreferences"],
  },

  // DAT-004 -- past/queued/ready export requests. One list per user (no
  // detail split needed today -- polling re-runs this same "lists" query
  // rather than reading a separate per-request cache entry), following the
  // same lists()/detail() shape recurring/expenses already use so a future
  // per-request cache entry could slot in without restructuring this file.
  exports: {
    all: ["exports"],
    lists: () => [...queryKeys.exports.all, "list"],
  },

  // OCR-004 -- persisted receipt inbox (upload image + OCR-extracted
  // fields, review status, and expense link). list(filters) keeps each
  // reviewStatus/linked filter combination in its own cache entry, and
  // detail(id) backs the single-receipt view -- same lists()/list(filters)/
  // detail(id) shape expenses/recurring already use.
  receipts: {
    all: ["receipts"],
    lists: () => [...queryKeys.receipts.all, "list"],
    list: (filters) => [...queryKeys.receipts.lists(), filters],
    detail: (id) => [...queryKeys.receipts.all, "detail", id],
    // OCR-005 -- possible duplicate candidates for a single receipt, kept
    // separate from detail(id) so a duplicate-decision mutation can
    // invalidate just this without forcing a refetch of every other
    // detail-view consumer, same per-concern key split lists()/detail()
    // already follow.
    duplicates: (id) => [...queryKeys.receipts.all, "duplicates", id],
  },

  // IMP-001 -- CSV bulk import sessions. list() is the lightweight session
  // history (no `rows`); detail(id) is the single session's full preview
  // (with `rows`), kept separate so a row-decision/commit refetch on one
  // session doesn't force a refetch of the whole history list, same
  // list()/detail(id) split queryKeys.receipts above already follows.
  imports: {
    all: ["imports"],
    list: () => [...queryKeys.imports.all, "list"],
    detail: (id) => [...queryKeys.imports.all, "detail", id],
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
