import { useQuery } from "@tanstack/react-query";
import { getPieCategoryData, getPieComparisonData } from "../../api/chartApi";
import { queryKeys } from "../../query/queryKeys";

// Resolves the active pie-chart filter mode into a stable cache key, query function, and enabled flag.
const resolvePieChartMode = (show, viewBy) => {
  if (show === "distribution" || show === "count") {
    const type = show === "distribution" ? "total" : "count";
    const year = viewBy === "thisyear" ? new Date().getFullYear() : undefined;

    return {
      filters: { mode: show, viewBy },
      queryFn: ({ signal }) => getPieCategoryData(type, year, signal),
      enabled: true,
    };
  }

  if (show === "comparison") {
    return {
      filters: { mode: "comparison" },
      queryFn: ({ signal }) => getPieComparisonData(signal),
      enabled: true,
    };
  }

  // No complete filter selection yet — stays disabled so nothing fetches until the user finishes choosing.
  return { filters: { mode: "none" }, queryFn: () => null, enabled: false };
};

export const usePieChartQuery = (show, viewBy) => {
  const { filters, queryFn, enabled } = resolvePieChartMode(show, viewBy);

  // Filter changes intentionally show a loading transition rather than the previous chart's data — matches the prior UX of clearing chart data immediately on filter change.
  return useQuery({
    queryKey: queryKeys.charts.pie(filters),
    queryFn,
    enabled,
  });
};
