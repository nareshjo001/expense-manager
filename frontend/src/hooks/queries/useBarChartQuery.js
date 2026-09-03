import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { getBarChartByCategory, getBarChartByMonth } from "../../api/chartApi";
import { queryKeys } from "../../query/queryKeys";

// Resolves the active bar-chart filter mode into a stable cache key, query function, and enabled flag.
const resolveBarChartMode = (viewBy, month, specificMonth, selectedYear) => {
  if (viewBy === "bycategory" && !specificMonth) {
    return {
      filters: { mode: "category" },
      queryFn: ({ signal }) => getBarChartByCategory(undefined, signal),
      enabled: true,
    };
  }

  if (viewBy === "bycategory" && specificMonth && month) {
    return {
      filters: { mode: "category", month },
      queryFn: ({ signal }) => getBarChartByCategory(month, signal),
      enabled: true,
    };
  }

  if (viewBy === "bymonth" && selectedYear.length === 4) {
    return {
      filters: { mode: "month", year: selectedYear },
      queryFn: ({ signal }) => getBarChartByMonth(selectedYear, signal),
      enabled: true,
    };
  }

  // No complete filter selection yet — stays disabled so nothing fetches until the user finishes choosing.
  return { filters: { mode: "none" }, queryFn: () => null, enabled: false };
};

export const useBarChartQuery = (viewBy, month, specificMonth, selectedYear) => {
  const { filters, queryFn, enabled } = resolveBarChartMode(viewBy, month, specificMonth, selectedYear);

  // FE-001-T05 -- keeps the previously loaded chart visible while a
  // filter change refetches a NEW query key, instead of clearing to a
  // loading state; isPlaceholderData (exposed via the spread below) lets
  // the page show a subtle "still refreshing" indicator over it.
  const query = useQuery({
    queryKey: queryKeys.charts.bar(filters),
    queryFn,
    enabled,
    placeholderData: keepPreviousData,
  });

  // FE-001 -- callers need `enabled` to tell "no filter chosen yet" (query
  // intentionally disabled) apart from an active loading/error/empty state.
  return { ...query, enabled };
};
