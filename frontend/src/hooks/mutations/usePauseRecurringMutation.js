import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getRecurringDefinition, pauseRecurringDefinition } from "../../api/recurringApi";
import { queryKeys } from "../../query/queryKeys";

// REC-002-T05/REC-003-T05 -- pauses a recurring definition.
//
// Re-fetches the definition immediately before mutating rather than trusting
// a scheduleVersion the caller may already be holding: this hook is shared
// by the management screen (which lists scheduleVersion but may be stale by
// the time a button is clicked) AND the Upcoming view's quick action (which
// never fetches a definition directly at all, only its projected
// occurrences). One fetch-then-mutate round trip keeps both callers correct
// without duplicating the CAS bookkeeping in each.
export const usePauseRecurringMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }) => {
      const detail = await getRecurringDefinition(id);
      return pauseRecurringDefinition(id, detail?.data?.scheduleVersion);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recurring.all });
    },
  });
};
