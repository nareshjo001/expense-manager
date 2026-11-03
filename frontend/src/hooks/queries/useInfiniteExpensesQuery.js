import { useInfiniteQuery } from "@tanstack/react-query";
import { searchExpenses } from "../../api/expenseApi";
import { queryKeys } from "../../query/queryKeys";

// Cursor-paginated variant of the custom-date-range expense search, fetching one bounded page from the network at a time instead of pulling the entire range and windowing it client-side.
const PAGE_SIZE = 50;

// `searchFilters` (nameContains/category/minAmount/ maxAmount/isRecurring) is optional and defaults to {} so every existing caller keeps working unchanged.
export const useInfiniteExpensesQuery = (startDate, endDate, enabled, searchFilters = {}) => {
  return useInfiniteQuery({
    queryKey: queryKeys.expenses.list({ mode: "custom", startDate, endDate, ...searchFilters }),
    queryFn: ({ pageParam, signal }) =>
      searchExpenses(startDate, endDate, signal, { limit: PAGE_SIZE, cursor: pageParam, ...searchFilters }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => (lastPage?.success && lastPage.hasMore ? lastPage.nextCursor : undefined),
    enabled,
  });
};
