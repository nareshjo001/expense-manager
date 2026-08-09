import { useQuery } from "@tanstack/react-query";
import { getSiaSessions } from "../../api/siaSessionsApi";
import { queryKeys } from "../../query/queryKeys";

// Lists the caller's own SIA conversations. Disabled by default so opening
// the app never fetches conversation history -- it is only requested once
// the user actually opens the history view.
export const useSiaSessionsQuery = (enabled = false) => {
  return useQuery({
    queryKey: queryKeys.sia.sessions.list(),
    // Forwards TanStack's abort signal so a superseded fetch is actually
    // cancelled at the transport level, matching the repository's existing
    // query convention.
    queryFn: ({ signal }) => getSiaSessions(signal),
    enabled,
  });
};
