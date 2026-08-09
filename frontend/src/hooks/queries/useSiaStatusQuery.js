import { useQuery } from "@tanstack/react-query";
import { getSiaStatus } from "../../api/siaSessionsApi";
import { queryKeys } from "../../query/queryKeys";

// Runtime SIA availability -- Batch 3E.
//
// Answers "can the user submit a NEW question right now?", which is a
// different question from "is the SIA feature exposed in this build at
// all?" (that remains REACT_APP_SIA_ENABLED's job, checked by
// SiaEntryPoint). Both must be satisfied to submit; neither implies the
// other.
//
// FAIL CLOSED is the whole design rule here. Submission is enabled ONLY on
// a response that is unambiguously `{ success: true, available: true }`.
// A network failure, a non-2xx, a malformed body, a truthy-but-not-`true`
// value, or a still-loading state all resolve to "not available" -- the
// user keeps read access to their history, and never gets a composer that
// silently produces failures.

// Deliberately strict: only the exact boolean `true` on BOTH fields counts.
// A string "true", a 1, or a missing field is treated as unavailable rather
// than coerced -- mirroring the same exact-value discipline the backend's
// own SIA_ENABLED parsing uses (see backend/sia/config.js).
export function isSiaAvailableResponse(data) {
  return Boolean(data) && data.success === true && data.available === true;
}

// Availability changes only when an operator redeploys or edits server
// configuration -- never in response to anything the user does. A 5-minute
// stale time keeps a mounted session from re-requesting on every panel
// open, while still allowing a natural recheck in a long-lived tab.
const STALE_TIME_MS = 5 * 60 * 1000;

export const useSiaStatusQuery = (enabled = false) => {
  return useQuery({
    queryKey: queryKeys.sia.status(),
    // Forwards TanStack's abort signal so a superseded fetch is cancelled
    // at the transport level, matching this repository's existing query
    // convention (see useSiaSessionsQuery).
    queryFn: ({ signal }) => getSiaStatus(signal),
    // Never requested when the build-time flag has SIA switched off --
    // SiaEntryPoint returns null in that case and this hook is passed
    // `false`, so a disabled build issues no SIA network traffic at all.
    enabled,
    staleTime: STALE_TIME_MS,
    // Bounded, NOT continuous polling: one retry covers a transient blip,
    // after which the UI shows the unavailable state with an explicit user-
    // driven Retry. No refetchInterval anywhere -- a background poll on
    // every mounted client would be pure load for a value that changes only
    // on redeploy.
    retry: 1,
    refetchOnWindowFocus: false,
  });
};

export default useSiaStatusQuery;
