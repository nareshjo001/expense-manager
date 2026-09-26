import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteCategoryBudget } from "../../api/categoryBudgetApi";
import { queryKeys } from "../../query/queryKeys";

// Writes the summary a successful PUT/DELETE returns into that month's
// cache entry, in the same { success, contractVersion, data } envelope the
// GET returns. Falls back to invalidating if the response has no summary.
const applySummary = (queryClient, response, fallbackMonth) => {
  const summary = response?.data?.summary;
  if (response?.success && summary?.month) {
    queryClient.setQueryData(queryKeys.budgets.category(summary.month), {
      success: true,
      contractVersion: response.contractVersion,
      data: summary,
    });
    return;
  }
  queryClient.invalidateQueries({
    queryKey: queryKeys.budgets.category(fallbackMonth),
  });
};

// BUD-001-T05 -- delete a category budget by id. `month` is only used to
// address the cache entry; the backend identifies the allocation by id.
export const useDeleteCategoryBudgetMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }) => deleteCategoryBudget(id),
    onSuccess: (data, variables) => {
      applySummary(queryClient, data, variables.month);
    },
    // e.g. CATEGORY_BUDGET_NOT_FOUND after a delete from another tab --
    // refetch so the stale row disappears.
    onError: (error, variables) => {
      if (error?.response) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.budgets.category(variables.month),
        });
      }
    },
  });
};
