import api from "./axios";

// Thin wrappers over the /chart routes, routed through the shared axios instance for centralized auth/error handling.

export const getBarChartByCategory = async (month, signal) => {
  const { data } = await api.get("/chart/barchartbycategory", {
    params: month ? { month } : undefined,
    signal,
  });
  return data;
};

export const getBarChartByMonth = async (year, signal) => {
  const { data } = await api.get("/chart/barchartbymonth", {
    params: { year },
    signal,
  });
  return data;
};

export const getTrendChartByWeek = async (selectedYear, selectedMonth, signal) => {
  const { data } = await api.get("/chart/linechartbyweek", {
    params: { selectedYear, selectedMonth },
    signal,
  });
  return data;
};

export const getTrendChartByMonth = async (selectedYear, signal) => {
  const { data } = await api.get("/chart/linechartbymonth", {
    params: { selectedYear },
    signal,
  });
  return data;
};

export const getTrendChartByYear = async (signal) => {
  const { data } = await api.get("/chart/linechartbyyear", { signal });
  return data;
};

export const getTrendChartBetweenYears = async (years, signal) => {
  const { data } = await api.get("/chart/linechartbetweenyears", {
    params: { years: years.join(",") },
    signal,
  });
  return data;
};

export const getLoggedYears = async (signal) => {
  const { data } = await api.get("/chart/getloggedyears", { signal });
  return data;
};

export const getPieCategoryData = async (type, year, signal) => {
  const { data } = await api.get("/chart/getPieCategoryData", {
    params: year ? { type, year } : { type },
    signal,
  });
  return data;
};

export const getPieComparisonData = async (signal) => {
  const { data } = await api.get("/chart/getcomparisonforpie", { signal });
  return data;
};
