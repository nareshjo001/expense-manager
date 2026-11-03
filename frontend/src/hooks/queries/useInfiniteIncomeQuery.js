import { useInfiniteQuery } from "@tanstack/react-query";
import { getIncome } from "../../api/incomeApi";
import { queryKeys } from "../../query/queryKeys";

// Cursor-paginated variant of the income list, fetching one bounded page from the network at a time instead of the previous unbounded fetch.
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
