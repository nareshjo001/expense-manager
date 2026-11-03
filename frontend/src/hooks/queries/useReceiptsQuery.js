import { useQuery } from "@tanstack/react-query";
import { listReceipts } from "../../api/receiptsApi";
import { queryKeys } from "../../query/queryKeys";

// Backs the receipt inbox list.
export const useReceiptsQuery = ({ reviewStatus, linked } = {}) => {
  const filters = {
    reviewStatus: reviewStatus || null,
    linked: typeof linked === "boolean" ? linked : null,
  };

  return useQuery({
    queryKey: queryKeys.receipts.list(filters),
    queryFn: ({ signal }) => listReceipts({ reviewStatus, linked }, signal),
  });
};
