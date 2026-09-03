import { useMutation, useQueryClient } from "@tanstack/react-query";
import { saveMerchantRule } from "../../api/mlApi";
import { queryKeys } from "../../query/queryKeys";

// CAT-001 -- creates or updates (upsert-by-merchant) the caller's rule; used both by the post-correction save prompt and the rule management screen.
export const useSaveMerchantRuleMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ merchantName, category }) => saveMerchantRule(merchantName, category),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.merchantRules.all });
    },
  });
};
