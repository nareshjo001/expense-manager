import api from "./axios";

// Thin wrappers over the /expense routes, routed through the shared axios instance for centralized auth/error handling.

export const getLastWeekExpenses = async (signal) => {
  const { data } = await api.get("/expense/last-week", { signal });
  return data;
};

export const getExpensesByCategory = async (period, signal) => {
  const { data } = await api.get("/expense/by-category", {
    params: { period },
    signal,
  });
  return data;
};

// EXP-003-T03 -- `pagination` ({ limit, cursor }) is optional to PASS, but the
// response is bounded either way: omitting `limit` no longer returns the full
// range, it returns the server's default page (50) plus `hasMore` and
// `nextCursor`. A caller that needs everything must page through the cursors.
// Callers that ignore hasMore will silently show only the first page.
// EXP-002-T05 -- `options` now also carries the four optional search
// filters EXP-002-T01 defined (nameContains/category/minAmount/maxAmount/
// isRecurring), on top of the existing pagination fields. Each one is only
// added to the request when actually set -- omitted entirely means "no
// filter" per the backend contract (EXP-002-T02/T04), not "filter for
// empty/zero". minAmount/maxAmount/isRecurring use `!== undefined` rather
// than truthiness so a real 0 or `false` is never dropped.
export const searchExpenses = async (startDate, endDate, signal, options) => {
  const { data } = await api.get("/expense/search", {
    params: {
      startDate,
      endDate,
      ...(options?.limit ? { limit: options.limit } : {}),
      ...(options?.cursor ? { cursor: options.cursor } : {}),
      ...(options?.nameContains ? { nameContains: options.nameContains } : {}),
      ...(options?.category ? { category: options.category } : {}),
      ...(options?.minAmount !== undefined ? { minAmount: options.minAmount } : {}),
      ...(options?.maxAmount !== undefined ? { maxAmount: options.maxAmount } : {}),
      ...(options?.isRecurring !== undefined ? { isRecurring: options.isRecurring } : {}),
    },
    signal,
  });
  return data;
};

export const addExpense = async (payload) => {
  const { data } = await api.post("/expense/add-expense", payload);
  return data;
};

export const getExpenseEditData = async (expenseId, signal) => {
  const { data } = await api.get("/expense/expense-edit-data", {
    params: { expenseId },
    signal,
  });
  return data;
};

export const updateExpense = async (editID, payload) => {
  const { data } = await api.put("/expense/update-expense", payload, {
    params: { editID },
  });
  return data;
};

// The backend reads the id from the request body, so it's passed via the data config key (axios's DELETE-body requirement).
export const deleteExpense = async (id) => {
  const { data } = await api.delete("/expense/delete-expense", {
    data: { id },
  });
  return data;
};

// Hits the shared /api/recurring route (not /expense) — kept here since ExpenseItem.js is its only caller.
export const updateRecurringStatus = async (expenseId, isRecurring) => {
  const { data } = await api.patch("/api/recurring", { expenseId, isRecurring });
  return data;
};
