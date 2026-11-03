import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commitImportSession } from "../../api/importsApi";
import { queryKeys } from "../../query/queryKeys";

// Commits an import session's accepted rows into real expenses.
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
