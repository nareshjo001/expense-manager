import api from "./axios";

// Thin wrappers over the /income routes, routed through the shared axios instance for centralized auth/error handling.

// EXP-003 -- `pagination` ({ limit, cursor }) is optional and additive; every
// existing caller that omits it keeps getting the full, unbounded list.
export const getIncome = async (period, signal, pagination) => {
  const params = { ...(period ? { period } : {}), ...(pagination?.limit ? { limit: pagination.limit } : {}), ...(pagination?.cursor ? { cursor: pagination.cursor } : {}) };
  const { data } = await api.get("/income/get", {
    params: Object.keys(params).length ? params : undefined,
    signal,
  });
  return data;
};

export const addIncome = async (payload) => {
  const { data } = await api.post("/income/add", payload);
  return data;
};

export const updateIncome = async (incomeId, newAmount) => {
  const { data } = await api.put("/income/edit", { incomeId, newAmount });
  return data;
};

export const deleteIncome = async (deleteIncomeId) => {
  const { data } = await api.delete("/income/delete", {
    data: { deleteIncomeId },
  });
  return data;
};

export const getIncomeSummary = async (period, signal) => {
  const { data } = await api.post("/income/insights-header", { period }, { signal });
  return data;
};

export const getIncomeInsights = async (period, signal) => {
  const { data } = await api.post("/income/insights-card", { period }, { signal });
  return data;
};
