import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unlinkReceipt } from "../../api/receiptsApi";
import { queryKeys } from "../../query/queryKeys";

// Unlinks a receipt from whatever expense it's currently linked to.
export const useUnlinkReceiptMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => unlinkReceipt(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.receipts.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.receipts.lists() });
    },
  });
};
