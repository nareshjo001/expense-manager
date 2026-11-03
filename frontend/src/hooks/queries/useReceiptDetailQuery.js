import { useQuery } from "@tanstack/react-query";
import { getReceipt } from "../../api/receiptsApi";
import { queryKeys } from "../../query/queryKeys";

// Js). Disabled until an id is actually selected, same enabled-guard shape useSiaSessionMessagesQuery already uses for a detail query that onl.
export const useReceiptDetailQuery = (receiptId) => {
  return useQuery({
    queryKey: queryKeys.receipts.detail(receiptId),
    queryFn: ({ signal }) => getReceipt(receiptId, signal),
    enabled: Boolean(receiptId),
  });
};
