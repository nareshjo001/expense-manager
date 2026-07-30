import { useQuery } from "@tanstack/react-query";
import { getBudgets } from "../../api/budgetApi";
import { queryKeys } from "../../query/queryKeys";

export const useBudgetsQuery = () => {
  return useQuery({
    queryKey: queryKeys.budgets.all,
    queryFn: ({ signal }) => getBudgets(signal),
  });
};
