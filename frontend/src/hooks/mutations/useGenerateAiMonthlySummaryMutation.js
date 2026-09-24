import { useMutation, useQueryClient } from "@tanstack/react-query";
import { generateAiMonthlySummary } from "../../api/aiSummaryApi";
import { queryKeys } from "../../query/queryKeys";

// AI-001-T06 -- triggers a fresh generate attempt and, on success,
// re-fetches the preference (its regenerationsUsed/regenerationsRemaining
// changed as a side effect of this same call on the backend -- see
// aiSummaryPreferenceService.recordRegeneration). The generated summary
// itself is NOT cached under a query key -- there is no GET endpoint for
// "the last generated summary" (see AI-001-T05's deliverable notes) -- the
// caller reads it straight off this mutation's own `data`.
export const useGenerateAiMonthlySummaryMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => generateAiMonthlySummary(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.aiSummary.preference() });
    },
  });
};
