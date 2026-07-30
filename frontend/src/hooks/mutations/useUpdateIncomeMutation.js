import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateIncome } from "../../api/incomeApi";
import { queryKeys } from "../../query/queryKeys";

export const useUpdateIncomeMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ incomeId, newAmount }) => updateIncome(incomeId, newAmount),
    // Invalidates income-derived data after a successful mutation.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.income.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
    },
  });
};
