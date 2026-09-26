import { useQuery } from "@tanstack/react-query";
import { getCategoryBudgets } from "../../api/categoryBudgetApi";
import { queryKeys } from "../../query/queryKeys";

// BUD-001-T05 -- one month's category-budget summary. Keyed under
// queryKeys.budgets.all, so every expense/total-budget mutation that already
// invalidates ["budgets"] refreshes spent/status here too.
export const useCategoryBudgetsQuery = (month) => {
  return useQuery({
    queryKey: queryKeys.budgets.category(month),
    queryFn: ({ signal }) => getCategoryBudgets(month, signal),
    enabled: Boolean(month),
  });
};
