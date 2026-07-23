import api from "./axios";

export const getReport = async () => {
  const { data } = await api.get("/report");
  return data;
};