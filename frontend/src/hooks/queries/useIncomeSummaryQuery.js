import { useQuery } from "@tanstack/react-query";
import { getIncomeSummary } from "../../api/incomeApi";
import { queryKeys } from "../../query/queryKeys";

export const useIncomeSummaryQuery = (period) => {
  return useQuery({
    queryKey: queryKeys.income.summary(period),
    queryFn: ({ signal }) => getIncomeSummary(period, signal),
  });
};
