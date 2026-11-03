import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateNotificationPreferences } from "../../api/notificationPreferencesApi";
import { queryKeys } from "../../query/queryKeys";

// Saves a partial preferences payload ({ types } and/or { quietHours }).
export const useSaveNotificationPreferencesMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (updates) => updateNotificationPreferences(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notificationPreferences.all });
    },
  });
};
