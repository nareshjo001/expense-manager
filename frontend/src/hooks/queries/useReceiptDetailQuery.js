import { useQuery } from "@tanstack/react-query";
import { getReceipt } from "../../api/receiptsApi";
import { queryKeys } from "../../query/queryKeys";

// OCR-004 -- backs the single-receipt detail view (ReceiptDetail.js).
// Disabled until an id is actually selected, same enabled-guard shape
// useSiaSessionMessagesQuery already uses for a detail query that only
// makes sense once something upstream has been picked.
export const useReceiptDetailQuery = (receiptId) => {
  return useQuery({
    queryKey: queryKeys.receipts.detail(receiptId),
    queryFn: ({ signal }) => getReceipt(receiptId, signal),
    enabled: Boolean(receiptId),
  });
};
