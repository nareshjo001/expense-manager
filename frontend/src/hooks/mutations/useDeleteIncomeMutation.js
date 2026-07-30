import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteIncome } from "../../api/incomeApi";
import { queryKeys } from "../../query/queryKeys";

export const useDeleteIncomeMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteIncome,
    // Invalidates income-derived data after a successful mutation.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.income.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
    },
  });
};
