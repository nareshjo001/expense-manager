import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getRecurringDefinition, skipRecurringOccurrence } from "../../api/recurringApi";
import { queryKeys } from "../../query/queryKeys";

// Skips a single upcoming recurring occurrence for a specific month.
// Fetches fresh scheduleVersion if not passed or stale, then invokes skip API
// and invalidates all recurring queries (upcoming projection + master list).
export const useSkipRecurringMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, date, scheduleVersion }) => {
      let version = scheduleVersion;
      if (typeof version !== "number") {
        const detail = await getRecurringDefinition(id);
        version = detail?.data?.scheduleVersion;
      }
      return skipRecurringOccurrence(id, date, version);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recurring.all });
    },
  });
};
