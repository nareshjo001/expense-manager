import { useQuery } from "@tanstack/react-query";
import { getLastWeekExpenses, getExpensesByCategory } from "../../api/expenseApi";
import { queryKeys } from "../../query/queryKeys";

// Resolves the active filter mode into a stable cache key, query function, and enabled flag.
// EXP-003-T05 -- the custom-date-range mode is deliberately absent here: it
// moved to useInfiniteExpensesQuery, since GET /expense/search is the only
// one of these three routes with cursor pagination to page against. A
// filter of "custom" therefore always falls through to the disabled
// default below -- ExpensesPage drives that mode from the infinite query
// instead of this hook.
const resolveExpenseMode = (filter, period) => {
  if (filter === "") {
    return {
      filters: { mode: "lastWeek" },
      queryFn: ({ signal }) => getLastWeekExpenses(signal),
      enabled: true,
    };
  }

  if (filter === "bycategory" && period) {
    return {
      filters: { mode: "category", period },
      queryFn: ({ signal }) => getExpensesByCategory(period, signal),
      enabled: true,
    };
  }

  // No complete filter selection yet (or "custom", handled separately) --
  // stays disabled so nothing fetches until the user finishes choosing.
  return { filters: { mode: "none" }, queryFn: () => null, enabled: false };
};

// Unifies last-week and by-category expense fetching behind one query per active filter mode.
export const useExpensesQuery = (filter, period) => {
  const { filters, queryFn, enabled } = resolveExpenseMode(filter, period);

  return useQuery({
    queryKey: queryKeys.expenses.list(filters),
    queryFn,
    enabled,
  });
};
