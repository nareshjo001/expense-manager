import { useMutation } from "@tanstack/react-query";
import { getImportHeaders } from "../../api/importsApi";

// Parses a just-selected CSV's header row and a suggested column mapping, before any import session exists yet.
export const useImportHeadersMutation = () => {
  return useMutation({
    mutationFn: ({ file, signal }) => getImportHeaders(file, signal),
  });
};
