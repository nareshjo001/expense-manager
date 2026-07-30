import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateBudget } from "../../api/budgetApi";
import { queryKeys } from "../../query/queryKeys";

export const useUpdateBudgetMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateBudget,
    // Invalidates budget, report, and chart data after a successful mutation.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.budgets.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.charts.all });
    },
  });
};
