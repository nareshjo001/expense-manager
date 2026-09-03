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

// EXP-003 -- `pagination` ({ limit, cursor }) is optional and additive; every
// existing caller that omits it keeps getting the full, unbounded range.
export const searchExpenses = async (startDate, endDate, signal, pagination) => {
  const { data } = await api.get("/expense/search", {
    params: {
      startDate,
      endDate,
      ...(pagination?.limit ? { limit: pagination.limit } : {}),
      ...(pagination?.cursor ? { cursor: pagination.cursor } : {}),
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
