import { useInfiniteQuery } from "@tanstack/react-query";
import { searchExpenses } from "../../api/expenseApi";
import { queryKeys } from "../../query/queryKeys";

// EXP-003-T05 -- cursor-paginated variant of the custom-date-range expense
// search, fetching one bounded page from the network at a time instead of
// pulling the entire range and windowing it client-side. Backend cursor
// pagination (limit + cursor) already exists on GET /expense/search
// (getbycustom.js); this is its first React Query consumer. The last-week
// and by-category expense modes stay on the plain useExpensesQuery -- their
// backend routes have no cursor support to page against.
const PAGE_SIZE = 50;

export const useInfiniteExpensesQuery = (startDate, endDate, enabled) => {
  return useInfiniteQuery({
    queryKey: queryKeys.expenses.list({ mode: "custom", startDate, endDate }),
    queryFn: ({ pageParam, signal }) =>
      searchExpenses(startDate, endDate, signal, { limit: PAGE_SIZE, cursor: pageParam }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => (lastPage?.success && lastPage.hasMore ? lastPage.nextCursor : undefined),
    enabled,
  });
};
