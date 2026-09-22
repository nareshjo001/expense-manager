import { useMutation, useQueryClient } from "@tanstack/react-query";
import { recordDuplicateDecision } from "../../api/receiptsApi";
import { queryKeys } from "../../query/queryKeys";

// OCR-005 -- records a "keep as new"/"link to existing" decision on a
// receipt's duplicate candidates. Invalidates this receipt's detail cache
// (duplicateStatus/duplicateOfReceiptId just changed), every list (a future
// duplicate-aware list filter would need to pick this up), and its
// duplicates cache (a decision changes what the banner should show next --
// e.g. once reviewed, the candidates shouldn't keep nagging the user), same
// detail+list invalidation shape useLinkReceiptMutation's sibling
// mutations already share, plus this one extra key.
export const useRecordDuplicateDecisionMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, decision, duplicateOfReceiptId }) =>
      recordDuplicateDecision(id, { decision, duplicateOfReceiptId }),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.receipts.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.receipts.lists() });
      queryClient.invalidateQueries({ queryKey: queryKeys.receipts.duplicates(id) });
    },
  });
};
