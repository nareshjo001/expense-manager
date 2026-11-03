import { useMutation, useQueryClient } from "@tanstack/react-query";
import { decideImportRow } from "../../api/importsApi";
import { queryKeys } from "../../query/queryKeys";

// Accept/skip a single preview row.
export const useDecideImportRowMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, rowIndex, decision }) => decideImportRow(id, rowIndex, decision),
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.imports.detail(id) });
    },
  });
};
