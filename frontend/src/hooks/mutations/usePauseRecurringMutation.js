import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getRecurringDefinition, pauseRecurringDefinition } from "../../api/recurringApi";
import { queryKeys } from "../../query/queryKeys";

// T05/REC-003-T05 -- pauses a recurring definition.
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
