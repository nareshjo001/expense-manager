import { useMutation, useQueryClient } from "@tanstack/react-query";
import { setBudget } from "../../api/budgetApi";
import { queryKeys } from "../../query/queryKeys";

export const useCreateBudgetMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: setBudget,
    // Invalidates budget, report, and chart data after a successful mutation.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.charts.all });
    },
  });
};
