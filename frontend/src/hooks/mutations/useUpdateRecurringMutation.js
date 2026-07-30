import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateRecurringStatus } from "../../api/expenseApi";
import { queryKeys } from "../../query/queryKeys";

// Flips isRecurring on a single matching expense inside a cached list, category map, or detail entry.
const patchRecurringInCache = (data, expenseId, isRecurring) => {
  if (!data?.success) return data;
  const payload = data.data;

  const patchExpense = (exp) =>
    exp && (exp._id === expenseId || exp.id === expenseId) ? { ...exp, isRecurring } : exp;

  if (Array.isArray(payload)) {
    return { ...data, data: payload.map(patchExpense) };
  }

  if (payload && typeof payload === "object") {
    if ("_id" in payload || "id" in payload) {
      return { ...data, data: patchExpense(payload) };
    }

    const nextData = {};
    for (const [key, list] of Object.entries(payload)) {
      nextData[key] = Array.isArray(list) ? list.map(patchExpense) : list;
    }
    return { ...data, data: nextData };
  }

  return data;
};

export const useUpdateRecurringMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ expenseId, isRecurring }) => updateRecurringStatus(expenseId, isRecurring),

    // Optimistically patches every cached expense query before the server confirms, and snapshots prior state for rollback.
    onMutate: async ({ expenseId, isRecurring }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.expenses.all });

      const previousQueries = queryClient.getQueriesData({ queryKey: queryKeys.expenses.all });

      queryClient.setQueriesData({ queryKey: queryKeys.expenses.all }, (old) =>
        patchRecurringInCache(old, expenseId, isRecurring)
      );

      return { previousQueries };
    },

    // Rolls every patched query back to its pre-mutation snapshot on failure.
    onError: (err, variables, context) => {
      context?.previousQueries?.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    },
  });
};
