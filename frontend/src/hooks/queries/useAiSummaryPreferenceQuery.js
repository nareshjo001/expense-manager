import { useQuery } from "@tanstack/react-query";
import { getAiSummaryPreference } from "../../api/aiSummaryApi";
import { queryKeys } from "../../query/queryKeys";

// Backs the monthly-insights AI-summary card's opt-in toggle and regeneration-usage display.
export const useAiSummaryPreferenceQuery = () => {
  return useQuery({
    queryKey: queryKeys.aiSummary.preference(),
    queryFn: ({ signal }) => getAiSummaryPreference(signal),
  });
};
