import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateNotificationPreferences } from "../../api/notificationPreferencesApi";
import { queryKeys } from "../../query/queryKeys";

// NOT-003-T05 -- saves a partial preferences payload ({ types } and/or
// { quietHours }). No CAS/version here -- see
// notificationPreferenceService.savePreferences's own comment on why
// last-write-wins is the right (not merely simpler) choice for a user's own
// settings, unlike REC-002's recurring-definition mutations.
export const useSaveNotificationPreferencesMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (updates) => updateNotificationPreferences(updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.notificationPreferences.all });
    },
  });
};
