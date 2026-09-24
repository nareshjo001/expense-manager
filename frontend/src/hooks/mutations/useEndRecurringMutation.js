import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getRecurringDefinition, endRecurringDefinition } from "../../api/recurringApi";
import { queryKeys } from "../../query/queryKeys";

// REC-002-T05/REC-003-T05 -- ends a recurring definition (terminal -- see
// RecurringExpense.js's own comment on 'ended'). See
// usePauseRecurringMutation.js's header for why this re-fetches
// scheduleVersion immediately before mutating.
export const useEndRecurringMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }) => {
      const detail = await getRecurringDefinition(id);
      return endRecurringDefinition(id, detail?.data?.scheduleVersion);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recurring.all });
    },
  });
};
