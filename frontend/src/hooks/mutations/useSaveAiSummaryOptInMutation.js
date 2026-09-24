import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateAiSummaryPreference } from "../../api/aiSummaryApi";
import { queryKeys } from "../../query/queryKeys";

// AI-001-T06 -- toggles opt-in for the monthly AI summary. Never touches
// the regeneration counter itself (see aiSummaryPreferenceService.setOptIn's
// own contract) -- invalidating the preference query after a successful
// save is enough to pick up any server-side count.
export const useSaveAiSummaryOptInMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (optedIn) => updateAiSummaryPreference(optedIn),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.aiSummary.preference() });
    },
  });
};
