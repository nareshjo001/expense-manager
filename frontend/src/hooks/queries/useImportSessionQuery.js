import { useQuery } from "@tanstack/react-query";
import { getImportSession } from "../../api/importsApi";
import { queryKeys } from "../../query/queryKeys";

// IMP-001 -- backs the mapping/preview/done steps of the import wizard
// once a session actually exists. Disabled until a session id is passed
// in, same enabled-guard shape useReceiptDetailQuery/
// useReceiptDuplicatesQuery already use for a detail query that only
// makes sense once something upstream (here: session creation) produced
// an id.
export const useImportSessionQuery = (sessionId) => {
  return useQuery({
    queryKey: queryKeys.imports.detail(sessionId),
    queryFn: ({ signal }) => getImportSession(sessionId, signal),
    enabled: Boolean(sessionId),
  });
};
