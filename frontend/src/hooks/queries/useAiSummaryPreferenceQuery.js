import { useQuery } from "@tanstack/react-query";
import { getAiSummaryPreference } from "../../api/aiSummaryApi";
import { queryKeys } from "../../query/queryKeys";

// AI-001-T06 -- backs the monthly-insights AI-summary card's opt-in toggle
// and regeneration-usage display. The response is always a complete
// { optedIn, regenerationsUsed, regenerationsRemaining } view, even for a
// user with no saved preference document yet (see
// aiSummaryPreferenceService.getPreference's own default-state contract),
// so this hook never needs a separate "does a preference exist" check.
export const useAiSummaryPreferenceQuery = () => {
  return useQuery({
    queryKey: queryKeys.aiSummary.preference(),
    queryFn: ({ signal }) => getAiSummaryPreference(signal),
  });
};
