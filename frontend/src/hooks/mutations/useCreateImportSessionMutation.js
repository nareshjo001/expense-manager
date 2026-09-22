import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createImportSession } from "../../api/importsApi";
import { queryKeys } from "../../query/queryKeys";

// IMP-001 -- creates the previewable import session from the mapped file.
// Invalidates the sessions list so a freshly created session shows up
// there too, same invalidate-the-list-on-create posture
// useCreateExportMutation's queued-export branch already follows.
export const useCreateImportSessionMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ file, columnMapping, signal }) => createImportSession(file, columnMapping, signal),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.imports.list() });
    },
  });
};
