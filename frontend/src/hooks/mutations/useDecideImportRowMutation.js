import { useMutation, useQueryClient } from "@tanstack/react-query";
import { decideImportRow } from "../../api/importsApi";
import { queryKeys } from "../../query/queryKeys";

// IMP-001 -- accept/skip a single preview row. The response is already
// the whole updated session, but this invalidates (rather than writing
// the response straight into the query cache) to keep the same
// fetch-after-mutate convention useRecordDuplicateDecisionMutation/
// useLinkReceiptMutation already use for their own detail caches.
export const useDecideImportRowMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, rowIndex, decision }) => decideImportRow(id, rowIndex, decision),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.imports.detail(id) });
    },
  });
};
