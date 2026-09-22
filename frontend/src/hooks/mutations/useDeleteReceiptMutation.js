import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteReceipt } from "../../api/receiptsApi";
import { queryKeys } from "../../query/queryKeys";

// OCR-004 -- deletes a receipt. The detail cache entry is REMOVED (not just
// invalidated) since a refetch of a deleted receipt would just 404 --
// there's nothing useful left to reconcile it against, same as how a
// deleted expense is dropped from its cached pages rather than refetched.
export const useDeleteReceiptMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => deleteReceipt(id),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.receipts.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.receipts.lists() });
    },
  });
};
