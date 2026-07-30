import api from "./axios";

// Fetches the aggregated financial report used by the monthly insights dashboard.
export const getReport = async (signal) => {
  const { data } = await api.get("/report", { signal });
  return data;
};