import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateExpense } from "../../api/expenseApi";
import { queryKeys } from "../../query/queryKeys";

export const useUpdateExpenseMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ editID, payload }) => updateExpense(editID, payload),
    // Invalidates expense, budget, report, and chart data after a successful mutation.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.charts.all });
    },
  });
};
