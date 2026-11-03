import { useMutation, useQueryClient } from "@tanstack/react-query";
import { editRecurringDefinition } from "../../api/recurringApi";
import { queryKeys } from "../../query/queryKeys";

// Edits a recurring definition's own future-affecting fields (name/category/amount/nextDueDate/endDate).
export const useEditRecurringMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates, scheduleVersion }) => editRecurringDefinition(id, updates, scheduleVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recurring.all });
    },
  });
};
