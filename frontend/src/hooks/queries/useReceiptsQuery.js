import { useQuery } from "@tanstack/react-query";
import { listReceipts } from "../../api/receiptsApi";
import { queryKeys } from "../../query/queryKeys";

// OCR-004 -- backs the receipt inbox list. Accepts the same
// reviewStatus/linked filters the inbox screen exposes; each distinct
// filter combination gets its own cache entry via queryKeys.receipts.list,
// the same lists()/list(filters) shape queryKeys.expenses/charts already
// use, rather than one shared cache entry that would go stale/wrong the
// moment the user flips a filter.
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
