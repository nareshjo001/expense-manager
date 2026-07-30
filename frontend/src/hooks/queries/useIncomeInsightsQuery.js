import { useQuery } from "@tanstack/react-query";
import { getIncomeInsights } from "../../api/incomeApi";
import { queryKeys } from "../../query/queryKeys";

export const useIncomeInsightsQuery = (period) => {
  return useQuery({
    queryKey: queryKeys.income.insights(period),
    queryFn: ({ signal }) => getIncomeInsights(period, signal),
  });
};
