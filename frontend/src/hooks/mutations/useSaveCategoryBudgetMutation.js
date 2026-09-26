import { useMutation, useQueryClient } from "@tanstack/react-query";
import { saveCategoryBudget } from "../../api/categoryBudgetApi";
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

// BUD-001-T05 -- create/edit a category budget (a single upsert, I12).
// The response carries the recomputed month summary, which is written
// straight into that month's cache entry instead of refetching.
export const useSaveCategoryBudgetMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ month, category, amount }) =>
      saveCategoryBudget({ month, category, amount }),
    onSuccess: (data, variables) => {
      applySummary(queryClient, data, variables.month);
    },
    // A rejected write (e.g. the month became read-only, the total budget
    // changed underneath us) means our cached summary may be out of date.
    onError: (error, variables) => {
      if (error?.response) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.budgets.category(variables.month),
        });
      }
    },
  });
};
