import { useQuery } from "@tanstack/react-query";
import {
  getTrendChartByWeek,
  getTrendChartByMonth,
  getTrendChartByYear,
  getTrendChartBetweenYears,
} from "../../api/chartApi";
import { queryKeys } from "../../query/queryKeys";

// Resolves the active trend-chart filter mode into a stable cache key, query function, and enabled flag.
const resolveTrendChartMode = (viewBy, selectedMonthYear, selectedYear, compareByYear, selectedYears) => {
  if (viewBy === "week" && selectedMonthYear) {
    const [year, month] = selectedMonthYear.split("-");
    return {
      filters: { mode: "week", selectedMonthYear },
      queryFn: ({ signal }) => getTrendChartByWeek(year, month, signal),
      enabled: true,
    };
  }

  if (viewBy === "bymonth" && selectedYear.length === 4) {
    return {
      filters: { mode: "month", year: selectedYear },
      queryFn: ({ signal }) => getTrendChartByMonth(selectedYear, signal),
      enabled: true,
    };
  }

  if (viewBy === "byyear" && !compareByYear) {
    return {
      filters: { mode: "year" },
      queryFn: ({ signal }) => getTrendChartByYear(signal),
      enabled: true,
    };
  }

  if (viewBy === "byyear" && compareByYear && selectedYears.length > 0) {
    return {
      filters: { mode: "betweenYears", years: selectedYears },
      queryFn: ({ signal }) => getTrendChartBetweenYears(selectedYears, signal),
      enabled: true,
    };
  }

  // No complete filter selection yet — stays disabled so nothing fetches until the user finishes choosing.
  return { filters: { mode: "none" }, queryFn: () => null, enabled: false };
};

export const useTrendChartQuery = (viewBy, selectedMonthYear, selectedYear, compareByYear, selectedYears) => {
  const { filters, queryFn, enabled } = resolveTrendChartMode(
    viewBy,
    selectedMonthYear,
    selectedYear,
    compareByYear,
    selectedYears
  );

  // Filter changes intentionally show a loading transition rather than the previous chart's data — matches the prior UX of clearing chart data immediately on filter change.
  return useQuery({
    queryKey: queryKeys.charts.trend(filters),
    queryFn,
    enabled,
  });
};
