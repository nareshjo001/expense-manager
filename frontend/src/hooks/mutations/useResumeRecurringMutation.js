import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getRecurringDefinition, resumeRecurringDefinition } from "../../api/recurringApi";
import { queryKeys } from "../../query/queryKeys";

// REC-002-T05 -- resumes a paused recurring definition. See
// usePauseRecurringMutation.js's header for why this re-fetches
// scheduleVersion immediately before mutating rather than trusting a
// caller-held value.
export const useResumeRecurringMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }) => {
      const detail = await getRecurringDefinition(id);
      return resumeRecurringDefinition(id, detail?.data?.scheduleVersion);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recurring.all });
    },
  });
};
