import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteExpense } from "../../api/expenseApi";
import { queryKeys } from "../../query/queryKeys";
import { removeExpenseFromCachedPages } from "../../query/pagedCacheReconciliation";

export const useDeleteExpenseMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteExpense,
    // Invalidates expense, budget, report, and chart data after a successful mutation.
    onSuccess: (_data, deletedExpenseId) => {
      // EXP-003-T06 -- removes the deleted expense from every already-cached
      // infinite (paged, custom-date-range) query immediately, so that list
      // updates without waiting on the network refetch invalidateQueries
      // still triggers below (which reconciles hasMore/nextCursor and any
      // concurrent-edit drift in the background). A no-op against the
      // plain last-week/by-category caches (no `.pages` to patch).
      removeExpenseFromCachedPages(queryClient, deletedExpenseId);

      queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.charts.all });
    },
  });
};
