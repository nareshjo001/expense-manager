import { useQuery } from "@tanstack/react-query";
import { getSiaStatus } from "../../api/siaSessionsApi";
import { queryKeys } from "../../query/queryKeys";

// Runtime SIA availability -- Batch 3E.

// Deliberately strict: only the exact boolean `true` on BOTH fields counts.
export function isSiaAvailableResponse(data) {
  return Boolean(data) && data.success === true && data.available === true;
}

// Availability changes only when an operator redeploys or edits server
const STALE_TIME_MS = 5 * 60 * 1000;

export const useSiaStatusQuery = (enabled = false) => {
  return useQuery({
    queryKey: queryKeys.sia.status(),
    // Forwards TanStack's abort signal so a superseded fetch is cancelled
    queryFn: ({ signal }) => getSiaStatus(signal),
    // Never requested when the build-time flag has SIA switched off --
    enabled,
    staleTime: STALE_TIME_MS,
    // Bounded, NOT continuous polling: one retry covers a transient blip,
    retry: 1,
    refetchOnWindowFocus: false,
  });
};

export default useSiaStatusQuery;
