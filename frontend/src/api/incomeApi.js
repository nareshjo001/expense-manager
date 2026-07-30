import api from "./axios";

// Thin wrappers over the /income routes, routed through the shared axios instance for centralized auth/error handling.

export const getIncome = async (signal) => {
  const { data } = await api.get("/income/get", { signal });
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
