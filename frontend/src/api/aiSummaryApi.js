import api from "./axios";

// Js.

export const getAiSummaryPreference = async (signal) => {
  const { data } = await api.get("/sia/monthly-summary/preferences", { signal });
  return data;
};

// `optedIn` must be a boolean -- the backend rejects anything else (see
// aiSummaryPreferenceService.setOptIn's own validation).
export const updateAiSummaryPreference = async (optedIn) => {
  const { data } = await api.put("/sia/monthly-summary/preferences", { optedIn });
  return data;
};

// Triggers a fresh generation attempt (LLM-authored when available and valid, the deterministic template otherwise -- generateMonthlySummary() on the backend already guarantees a safe result either way).
export const generateAiMonthlySummary = async () => {
  const { data } = await api.post("/sia/monthly-summary/generate");
  return data;
};
