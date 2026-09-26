import api from "./axios";

// BUD-001-T05 -- thin wrappers over the category-budget routes (contract:
// docs/budgets/BUD-001-T01-category-budget-invariants.md section 3), through
// the shared axios instance so auth refresh and 401/429/409 handling stay
// centralized, same convention as budgetApi.js.

// GET /api/category-budgets?month=YYYY-MM -> { success, contractVersion, data: summary }
export const getCategoryBudgets = async (month, signal) => {
  const { data } = await api.get("/api/category-budgets", {
    params: { month },
    signal,
  });
  return data;
};

// PUT /api/category-budgets -- upsert keyed on (month, category), so create
// and edit are the same call. `amount` is rupees exactly as the user typed
// it (the backend's parseAmountInput accepts the string and rejects more
// than 2 decimal places instead of silently rounding).
// -> { success, contractVersion, data: { budget, summary } }
export const saveCategoryBudget = async ({ month, category, amount }) => {
  // suppressConflictToast: the component shows the specific 409 reason
  // (exceeds total / too many categories) inline, so the shared interceptor's
  // generic "conflicts with existing data" toast would be a duplicate.
  const { data } = await api.put(
    "/api/category-budgets",
    { month, category, amount },
    { suppressConflictToast: true }
  );
  return data;
};

// DELETE /api/category-budgets/:id -> { success, contractVersion, data: { deletedId, summary } }
export const deleteCategoryBudget = async (id) => {
  const { data } = await api.delete(
    `/api/category-budgets/${encodeURIComponent(id)}`
  );
  return data;
};
