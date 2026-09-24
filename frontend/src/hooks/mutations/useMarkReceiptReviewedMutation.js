import { useMutation, useQueryClient } from "@tanstack/react-query";
import { markReceiptReviewed } from "../../api/receiptsApi";
import { queryKeys } from "../../query/queryKeys";

// OCR-004 -- marks a receipt reviewed, optionally saving field corrections
// alongside (ReceiptDetail.js's correction form, only shown while
// reviewStatus is "needs_review"). `corrections` is whatever the caller
// diffed out as actually changed -- possibly undefined, meaning "nothing to
// fix, just mark it reviewed" -- and markReceiptReviewed itself decides
// whether to send the key at all.
export const useMarkReceiptReviewedMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, corrections }) => markReceiptReviewed(id, corrections),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.receipts.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.receipts.lists() });
    },
  });
};
