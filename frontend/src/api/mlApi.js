import api from "./axios";

// CAT-001 -- thin wrappers over the /ml/merchant-rules routes, routed through the shared axios instance for centralized auth/error handling.

export const listMerchantRules = async (signal) => {
  const { data } = await api.get("/ml/merchant-rules", { signal });
  return data;
};

// Upserts by merchant: saving a rule for an already-ruled merchant replaces its category rather than creating a duplicate.
export const saveMerchantRule = async (merchantName, category) => {
  const { data } = await api.post("/ml/merchant-rules", { merchantName, category });
  return data;
};

export const deleteMerchantRule = async (ruleId) => {
  const { data } = await api.delete(`/ml/merchant-rules/${ruleId}`);
  return data;
};
