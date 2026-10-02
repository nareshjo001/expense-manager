import { useEffect, useMemo } from "react";
import { useInfiniteIncomeQuery } from "./useInfiniteIncomeQuery";

// The signed-in user's previously saved income sources, for the Add Income
// "Source of Income" suggestions. No endpoint returns the sources on their
// own, so they are derived from the existing all-time income list (GET
// /income/get, which the backend scopes to the JWT's user) through the
// existing paged income query and cache key.
//
// The list is cursor-paged. The remaining pages load in the background, up to
// MAX_SOURCE_PAGES pages (the user's most recent 500 income records at the
// list's 50-record page size), so this never turns back into an unbounded
// fetch.
export const MAX_SOURCE_PAGES = 10;

// Unique sources in the list's own order (newest income first). Sources that
// differ only in letter case or spacing count as one, shown with the most
// recent spelling.
export const deriveSavedIncomeSources = (pages) => {
  const seen = new Set();
  const sources = [];
  for (const page of pages ?? []) {
    if (!page?.success || !Array.isArray(page.data)) continue;
    for (const income of page.data) {
      const source = typeof income?.incomeSource === "string"
        ? income.incomeSource.trim().replace(/\s+/g, " ")
        : "";
      const key = source.toLowerCase();
      if (!source || seen.has(key)) continue;
      seen.add(key);
      sources.push(source);
    }
  }
  return sources;
};

export const useSavedIncomeSources = () => {
  const { data, hasNextPage, isFetchingNextPage, isError, fetchNextPage } = useInfiniteIncomeQuery(undefined, true);
  const loadedPages = data?.pages?.length ?? 0;

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError && loadedPages < MAX_SOURCE_PAGES) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, isError, loadedPages, fetchNextPage]);

  const sources = useMemo(() => deriveSavedIncomeSources(data?.pages), [data]);

  return { sources };
};
