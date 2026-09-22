import { useQuery } from "@tanstack/react-query";
import { listImportSessions } from "../../api/importsApi";
import { queryKeys } from "../../query/queryKeys";

// IMP-001 -- backs the import-session history (the "Import another file"
// / past-imports view). No filters, so a single cache entry is enough --
// same no-argument query shape queryKeys.exports.lists()/DataExport.js's
// own list query already uses.
export const useImportSessionsQuery = () => {
  return useQuery({
    queryKey: queryKeys.imports.list(),
    queryFn: ({ signal }) => listImportSessions(signal),
  });
};
