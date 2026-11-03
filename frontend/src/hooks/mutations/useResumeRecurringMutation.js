import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getRecurringDefinition, resumeRecurringDefinition } from "../../api/recurringApi";
import { queryKeys } from "../../query/queryKeys";

// Resumes a paused recurring definition.
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
