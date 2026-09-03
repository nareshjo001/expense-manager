import { useQuery, keepPreviousData } from "@tanstack/react-query";
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

  // FE-001-T05 -- keeps the previously loaded chart visible while a
  // filter change refetches a NEW query key, instead of clearing to a
  // loading state; isPlaceholderData (exposed via the spread below) lets
  // the page show a subtle "still refreshing" indicator over it.
  const query = useQuery({
    queryKey: queryKeys.charts.pie(filters),
    queryFn,
    enabled,
    placeholderData: keepPreviousData,
  });

  // FE-001 -- callers need `enabled` to tell "no filter chosen yet" (query
  // intentionally disabled) apart from an active loading/error/empty state.
  return { ...query, enabled };
};
