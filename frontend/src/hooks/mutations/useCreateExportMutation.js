import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createExport } from "../../api/exportApi";
import { queryKeys } from "../../query/queryKeys";

// DAT-004 -- creates an export request. exportApi.createExport already
// tells the two possible responses apart (see its own header comment) and
// resolves to either `{ file: true, blob, filename, contentType }` (a
// small/sync export) or the queued-export JSON envelope (a large/
// background export); this hook's only job is to ACT on that difference:
//   - a file response triggers an immediate browser download;
//   - both sync and queued exports persist a record so the past exports
//     list query is invalidated to immediately show the new record.
// Toasting which of the two happened is left to the caller (DataExport.js),
// same split as every other mutation hook in this app: the hook manages
// cache state, the component manages user feedback via its own
// onSuccess/onError passed to `.mutate()`.
const triggerBrowserDownload = (blob, filename) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "export";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

export const useCreateExportMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload) => createExport(payload),
    onSuccess: (result) => {
      if (result?.file) {
        triggerBrowserDownload(result.blob, result.filename);
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.exports.lists() });
    },
  });
};
