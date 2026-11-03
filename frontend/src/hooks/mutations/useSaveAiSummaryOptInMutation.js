import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateAiSummaryPreference } from "../../api/aiSummaryApi";
import { queryKeys } from "../../query/queryKeys";

// Toggles opt-in for the monthly AI summary.
export const useSaveAiSummaryOptInMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (optedIn) => updateAiSummaryPreference(optedIn),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.aiSummary.preference() });
    },
  });
};
