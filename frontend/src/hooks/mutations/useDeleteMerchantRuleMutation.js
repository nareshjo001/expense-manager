import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteMerchantRule } from "../../api/mlApi";
import { queryKeys } from "../../query/queryKeys";

// CAT-001 -- deletes one saved merchant rule from the rule management screen.
export const useDeleteMerchantRuleMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ruleId) => deleteMerchantRule(ruleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.merchantRules.all });
    },
  });
};
