import { useMutation, useQueryClient } from "@tanstack/react-query";
import { linkReceipt } from "../../api/receiptsApi";
import { queryKeys } from "../../query/queryKeys";

// OCR-004 -- links a receipt to an existing expense. Invalidates both this
// receipt's detail cache (linkedExpenseId/linkedAt just changed) and every
// list (a "linked" filter view needs to pick this receipt up/drop it), same
// detail+list invalidation shape useLinkReceiptMutation's sibling mutations
// below all share.
export const useLinkReceiptMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, expenseId }) => linkReceipt(id, expenseId),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.receipts.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.receipts.lists() });
    },
  });
};
