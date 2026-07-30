import api from "./axios";

// Thin wrappers over the /api budget routes, routed through the shared axios instance for centralized auth/error handling.

export const getBudgets = async (signal) => {
  const { data } = await api.get("/api/getbudgets", { signal });
  return data;
};

export const setBudget = async (budget) => {
  const { data } = await api.post("/api/setbudget", { budget });
  return data;
};

export const updateBudget = async (budget) => {
  const { data } = await api.put("/api/update-budget", { budget });
  return data;
};
