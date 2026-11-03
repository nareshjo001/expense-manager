import { useMutation, useQueryClient } from "@tanstack/react-query";
import { linkReceipt } from "../../api/receiptsApi";
import { queryKeys } from "../../query/queryKeys";

// Links a receipt to an existing expense.
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
