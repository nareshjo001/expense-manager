import { useMutation, useQueryClient } from "@tanstack/react-query";
import { recordDuplicateDecision } from "../../api/receiptsApi";
import { queryKeys } from "../../query/queryKeys";

// Records a "keep as new"/"link to existing" decision on a receipt's duplicate candidates.
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
