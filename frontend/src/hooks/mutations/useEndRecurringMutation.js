import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getRecurringDefinition, endRecurringDefinition } from "../../api/recurringApi";
import { queryKeys } from "../../query/queryKeys";

// Js's own comment on 'ended'). js's header for why this re-fetches scheduleVersion immediately before mutating.
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
