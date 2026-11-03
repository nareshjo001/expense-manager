import { useQuery } from "@tanstack/react-query";
import { getLastWeekExpenses, getExpensesByCategory } from "../../api/expenseApi";
import { queryKeys } from "../../query/queryKeys";

// Resolves the active filter mode into a stable cache key, query function, and enabled flag.
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
