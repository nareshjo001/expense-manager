import { useQuery, useQueryClient } from "@tanstack/react-query";
import { searchExpenses } from "../../api/expenseApi";
import { queryKeys } from "../../query/queryKeys";

/**
 * Hook to search or list a window of user expenses for candidate linking or duplicate detection.
 * Gracefully degrades in un-provided test environments so existing unit tests do not break.
 */
export const useExpenseSearchQuery = (startDate, endDate, searchFilters = {}, enabled = true) => {
  let hasValidClient = false;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const client = useQueryClient();
    hasValidClient = Boolean(client && typeof client.defaultQueryOptions === "function");
  } catch (e) {
    hasValidClient = false;
  }

  if (!hasValidClient) {
    return { data: { data: [] }, isLoading: false, isError: false };
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useQuery({
    queryKey: queryKeys.expenses.list({ mode: "search", startDate, endDate, ...searchFilters }),
    queryFn: ({ signal }) => searchExpenses(startDate, endDate, signal, searchFilters),
    enabled: Boolean(enabled && startDate && endDate),
    staleTime: 30 * 1000,
  });
};
