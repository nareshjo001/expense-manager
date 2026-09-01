import { useQuery } from "@tanstack/react-query";
import { getSiaSessions } from "../../api/siaSessionsApi";
import { queryKeys } from "../../query/queryKeys";

// Lists the caller's own SIA conversations. Disabled by default so opening
export const useSiaSessionsQuery = (enabled = false) => {
  return useQuery({
    queryKey: queryKeys.sia.sessions.list(),
    // Forwards TanStack's abort signal so a superseded fetch is actually
    queryFn: ({ signal }) => getSiaSessions(signal),
    enabled,
  });
};
