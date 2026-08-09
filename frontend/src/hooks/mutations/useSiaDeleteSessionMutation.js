import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteSiaSession } from "../../api/siaSessionsApi";
import { queryKeys } from "../../query/queryKeys";

// Deletes one SIA conversation thread (never any financial data).
//
// Deliberately NOT optimistic: the list is only updated once the server
// confirms, so a failed delete simply leaves the row where it was with no
// rollback logic to get wrong. On success the list is invalidated and that
// session's cached messages are dropped outright -- they can never be
// valid again.
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
