import { useQuery } from "@tanstack/react-query";
import { getImportSession } from "../../api/importsApi";
import { queryKeys } from "../../query/queryKeys";

// Backs the mapping/preview/done steps of the import wizard once a session actually exists.
export const useImportSessionQuery = (sessionId) => {
  return useQuery({
    queryKey: queryKeys.imports.detail(sessionId),
    queryFn: ({ signal }) => getImportSession(sessionId, signal),
    enabled: Boolean(sessionId),
  });
};
