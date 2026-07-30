import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addExpense } from "../../api/expenseApi";
import { queryKeys } from "../../query/queryKeys";

export const useAddExpenseMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: addExpense,
    // Invalidates expense, budget, report, and chart data after a successful mutation.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.expenses.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.charts.all });
    },
  });
};
