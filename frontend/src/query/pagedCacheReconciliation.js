import { queryKeys } from "./queryKeys";

// EXP-003-T06 -- shared helper for surgically removing one deleted record
// from every already-cached infinite (paged) query under a given key
// prefix, instead of waiting on the network refetch that invalidateQueries
// separately still triggers. A no-op against a plain (non-infinite) cache
// entry -- it only ever touches `.pages`, so the still-unpaginated
// last-week/by-category expense caches and any other plain query pass
// through unchanged.
//
// Deliberately deletion-only: where a NEW or edited record belongs among
// cursor-ordered pages is ambiguous (it depends on sort position relative
// to a cursor this client never computed), so add/update mutations don't
// use this and instead rely on the background refetch invalidateQueries
// already triggers. A removal has no such ambiguity -- the record is
// simply gone from wherever it was.
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
