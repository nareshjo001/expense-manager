import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateSiaPreference } from "../../api/siaPreferenceApi";
import { queryKeys } from "../../query/queryKeys";

// SIA-001-T06 -- toggles per-user SIA enable/disable. Invalidating the
// preference query after a successful save picks up the server's saved
// state, same convention as useSaveAiSummaryOptInMutation.
export const useSaveSiaPreferenceMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (enabled) => updateSiaPreference(enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sia.preference() });
    },
  });
};
