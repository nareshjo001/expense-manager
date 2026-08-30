import { useQuery } from "@tanstack/react-query";
import { getIncome } from "../../api/incomeApi";
import { queryKeys } from "../../query/queryKeys";

// Only fetches while the caller marks it enabled, e.g. while IncomeModal is open.
export const useIncomeListQuery = (period, enabled) => {
  return useQuery({
    queryKey: queryKeys.income.list(period),
    queryFn: ({ signal }) => getIncome(period, signal),
    enabled,
  });
};
