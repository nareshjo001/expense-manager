import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createExport } from "../../api/exportApi";
import { queryKeys } from "../../query/queryKeys";

// DAT-004 -- creates an export request. exportApi.createExport already
// tells the two possible responses apart (see its own header comment) and
// resolves to either `{ file: true, blob, filename, contentType }` (a
// small/sync export) or the queued-export JSON envelope (a large/
// background export); this hook's only job is to ACT on that difference:
//   - a file response triggers an immediate browser download and is done;
//   - a queued response needs the export-requests list to pick the new
//     request up, so that list query is invalidated -- same
//     invalidate-on-success shape as useSaveNotificationPreferencesMutation.
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
      } else {
        queryClient.invalidateQueries({ queryKey: queryKeys.exports.lists() });
      }
    },
  });
};
