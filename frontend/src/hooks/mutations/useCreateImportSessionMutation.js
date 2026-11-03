import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createImportSession } from "../../api/importsApi";
import { queryKeys } from "../../query/queryKeys";

// Creates the previewable import session from the mapped file.
export const useCreateImportSessionMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ file, columnMapping, signal }) => createImportSession(file, columnMapping, signal),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.imports.list() });
    },
  });
};
