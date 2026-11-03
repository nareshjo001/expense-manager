import { useQuery } from "@tanstack/react-query";
import { getNotificationPreferences } from "../../api/notificationPreferencesApi";
import { queryKeys } from "../../query/queryKeys";

// Backs the notification-preferences settings screen. js -- so this hook never needs a separate "what types exist" fetch.
export const useNotificationPreferencesQuery = () => {
  return useQuery({
    queryKey: queryKeys.notificationPreferences.all,
    queryFn: ({ signal }) => getNotificationPreferences(signal),
  });
};
