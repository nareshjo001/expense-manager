import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commitImportSession } from "../../api/importsApi";
import { queryKeys } from "../../query/queryKeys";

// IMP-001 -- commits an import session's accepted rows into real
// expenses. Invalidates both this session's detail (status/committedAt/
// committedCount/skippedCount/each row's committedExpenseId all just
// changed) and the sessions list (status changed there too), same
// detail+list invalidation shape useLinkReceiptMutation's sibling
// mutations use.
export const useCommitImportSessionMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => commitImportSession(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.imports.detail(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.imports.list() });
    },
  });
};
