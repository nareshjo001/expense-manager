import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addIncome } from "../../api/incomeApi";
import { queryKeys } from "../../query/queryKeys";

export const useAddIncomeMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: addIncome,
    // Invalidates income-derived data after a successful mutation.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.income.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
    },
  });
};
