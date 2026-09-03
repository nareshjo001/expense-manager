import { useInfiniteQuery } from "@tanstack/react-query";
import { getIncome } from "../../api/incomeApi";
import { queryKeys } from "../../query/queryKeys";

// EXP-003-T05 -- cursor-paginated variant of the income list, fetching one
// bounded page from the network at a time instead of the previous
// unbounded fetch. Backend cursor pagination (limit + cursor) already
// exists on GET /income/get (getIncome.js); this is its first React Query
// consumer, replacing useIncomeListQuery in IncomeModal.
const PAGE_SIZE = 50;

export const useInfiniteIncomeQuery = (period, enabled) => {
  return useInfiniteQuery({
    queryKey: queryKeys.income.list(period),
    queryFn: ({ pageParam, signal }) => getIncome(period, signal, { limit: PAGE_SIZE, cursor: pageParam }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => (lastPage?.success && lastPage.hasMore ? lastPage.nextCursor : undefined),
    enabled,
  });
};
