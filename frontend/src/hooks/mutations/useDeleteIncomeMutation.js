import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteIncome } from "../../api/incomeApi";
import { queryKeys } from "../../query/queryKeys";
import { removeIncomeFromCachedPages } from "../../query/pagedCacheReconciliation";

export const useDeleteIncomeMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteIncome,
    // Invalidates income-derived data after a successful mutation.
    onSuccess: (_data, deletedIncomeId) => {
      // Js for why this is deletion-only.
      removeIncomeFromCachedPages(queryClient, deletedIncomeId);

      queryClient.invalidateQueries({ queryKey: queryKeys.income.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports.all });
    },
  });
};
