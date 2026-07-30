import { useQuery } from "@tanstack/react-query";
import { getIncome } from "../../api/incomeApi";
import { queryKeys } from "../../query/queryKeys";

// Only fetches while the caller marks it enabled, e.g. while IncomeModal is open.
export const useIncomeListQuery = (enabled) => {
  return useQuery({
    queryKey: queryKeys.income.list(),
    queryFn: ({ signal }) => getIncome(signal),
    enabled,
  });
};
