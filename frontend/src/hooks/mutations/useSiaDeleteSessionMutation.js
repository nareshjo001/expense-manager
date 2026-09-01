import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteSiaSession } from "../../api/siaSessionsApi";
import { queryKeys } from "../../query/queryKeys";

// Deletes one SIA conversation thread (never any financial data).
export const useSiaDeleteSessionMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteSiaSession,
    retry: 0,
    onSuccess: (_data, sessionId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sia.sessions.list() });
      queryClient.removeQueries({ queryKey: queryKeys.sia.sessions.messages(sessionId) });
    },
  });
};
