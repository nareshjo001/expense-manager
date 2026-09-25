import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteSiaHistory } from "../../api/siaPreferenceApi";
import { queryKeys } from "../../query/queryKeys";

// SIA-001-T06 -- deletes the caller's own SIA conversation history
// (independent of the enable/disable preference and of full account
// deletion). Invalidates every cached SIA session list/messages query so
// a still-open SIA panel reflects the deletion immediately rather than
// showing stale, now-deleted sessions until its next natural refetch.
export const useDeleteSiaHistoryMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => deleteSiaHistory(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sia.sessions.all() });
    },
  });
};
