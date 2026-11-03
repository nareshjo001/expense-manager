import { useQuery } from "@tanstack/react-query";
import { getCategoryBudgets } from "../../api/categoryBudgetApi";
import { queryKeys } from "../../query/queryKeys";

// One month's category-budget summary.
export const useCategoryBudgetsQuery = (month) => {
  return useQuery({
    queryKey: queryKeys.budgets.category(month),
    queryFn: ({ signal }) => getCategoryBudgets(month, signal),
    enabled: Boolean(month),
  });
};
