import { useQuery } from "@tanstack/react-query";
import { getReceiptDuplicates } from "../../api/receiptsApi";
import { queryKeys } from "../../query/queryKeys";

// Js. Same enabled-guard/shape as useReceiptDetailQuery -- disabled until a receipt is actually selected, since there's no id to check duplica.
export const useReceiptDuplicatesQuery = (receiptId) => {
  return useQuery({
    queryKey: queryKeys.receipts.duplicates(receiptId),
    queryFn: ({ signal }) => getReceiptDuplicates(receiptId, signal),
    enabled: Boolean(receiptId),
  });
};
