import { useQuery } from "@tanstack/react-query";
import { listMerchantRules } from "../../api/mlApi";
import { queryKeys } from "../../query/queryKeys";

// CAT-001 -- backs the merchant rule management screen (list of the user's saved merchant -> category rules).
export const useMerchantRulesQuery = () => {
  return useQuery({
    queryKey: queryKeys.merchantRules.all,
    queryFn: ({ signal }) => listMerchantRules(signal),
  });
};
