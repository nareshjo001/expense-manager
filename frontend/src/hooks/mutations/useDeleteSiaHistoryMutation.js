import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteSiaHistory } from "../../api/siaPreferenceApi";
import { queryKeys } from "../../query/queryKeys";

// Deletes the caller's own SIA conversation history (independent of the enable/disable preference and of full account deletion).
export const useDeleteSiaHistoryMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => deleteSiaHistory(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sia.sessions.all() });
    },
  });
};
