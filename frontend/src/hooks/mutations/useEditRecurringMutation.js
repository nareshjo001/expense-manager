import { useMutation, useQueryClient } from "@tanstack/react-query";
import { editRecurringDefinition } from "../../api/recurringApi";
import { queryKeys } from "../../query/queryKeys";

// REC-002-T05 -- edits a recurring definition's own future-affecting fields
// (name/category/amount/nextDueDate/endDate). Scoped to
// RecurringExpenseModel only -- never the historical Expense this
// definition originated from (REC-002-T03's schedule/history separation) --
// so this is deliberately a DIFFERENT action from editing the original
// expense via useUpdateExpenseMutation or similar; the caller supplies the
// scheduleVersion it read when it opened the edit form.
export const useEditRecurringMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates, scheduleVersion }) => editRecurringDefinition(id, updates, scheduleVersion),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recurring.all });
    },
  });
};
