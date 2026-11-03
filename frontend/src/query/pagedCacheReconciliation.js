import { queryKeys } from "./queryKeys";

// Shared helper for surgically removing one deleted record from every already-cached infinite (paged) query under a given key prefix, instead of waiting on the network refetch that invalidateQueries separately still triggers.
export function removeRecordFromCachedPages(queryClient, queryKeyPrefix, recordId) {
  if (recordId === undefined || recordId === null) return;

  queryClient.setQueriesData({ queryKey: queryKeyPrefix }, (cached) => {
    if (!cached?.pages) return cached;

    return {
      ...cached,
      pages: cached.pages.map((page) =>
        page?.success
          ? { ...page, data: page.data.filter((record) => String(record._id || record.id) !== String(recordId)) }
          : page
      ),
    };
  });
}

export const removeExpenseFromCachedPages = (queryClient, expenseId) =>
  removeRecordFromCachedPages(queryClient, queryKeys.expenses.all, expenseId);

export const removeIncomeFromCachedPages = (queryClient, incomeId) =>
  removeRecordFromCachedPages(queryClient, queryKeys.income.all, incomeId);
