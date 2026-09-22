import { useMutation } from "@tanstack/react-query";
import { getImportHeaders } from "../../api/importsApi";

// IMP-001 -- parses a just-selected CSV's header row and a suggested
// column mapping, before any import session exists yet. No cache to
// invalidate -- same "mutation that just hands data back to the caller,
// nothing persisted" shape useBillUploadMutation already uses for its own
// pre-persistence preview call.
export const useImportHeadersMutation = () => {
  return useMutation({
    mutationFn: ({ file, signal }) => getImportHeaders(file, signal),
  });
};
