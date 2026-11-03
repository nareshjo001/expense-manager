import api from "./axios";

// Js.

// GET /api/category-budgets?month=YYYY-MM -> { success, contractVersion, data: summary }
export const getCategoryBudgets = async (month, signal) => {
  const { data } = await api.get("/api/category-budgets", {
    params: { month },
    signal,
  });
  return data;
};

// PUT /api/category-budgets -- upsert keyed on (month, category), so create and edit are the same call.
export const saveCategoryBudget = async ({ month, category, amount }) => {
  // SuppressConflictToast: the component shows the specific 409 reason (exceeds total / too many categories) inline, so the shared interceptor's generic "conflicts with existing data" toast would be a duplicate.
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
