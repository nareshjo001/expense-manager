import { useQuery } from "@tanstack/react-query";
import { getSiaSessionMessages } from "../../api/siaSessionsApi";
import { queryKeys } from "../../query/queryKeys";

// Loads one conversation's messages. Keyed per session and disabled until
export const useSiaSessionMessagesQuery = (sessionId) => {
  return useQuery({
    queryKey: queryKeys.sia.sessions.messages(sessionId),
    queryFn: ({ signal }) => getSiaSessionMessages(sessionId, signal),
    enabled: Boolean(sessionId),
  });
};
