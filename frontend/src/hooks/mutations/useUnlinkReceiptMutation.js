import { useMutation, useQueryClient } from "@tanstack/react-query";
import { unlinkReceipt } from "../../api/receiptsApi";
import { queryKeys } from "../../query/queryKeys";

// OCR-004 -- unlinks a receipt from whatever expense it's currently linked
// to. `id` is passed straight as the mutate variable (not wrapped in an
// object) since unlinkReceipt only ever needs the one id, matching
// useDeleteReceiptMutation's own shape below.
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
