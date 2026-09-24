import { useQuery } from "@tanstack/react-query";
import { getNotificationPreferences } from "../../api/notificationPreferencesApi";
import { queryKeys } from "../../query/queryKeys";

// NOT-003-T05 -- backs the notification-preferences settings screen. The
// response is always registry-complete (every known type, plus quiet
// hours, plus typeMeta labels) -- see
// Controllers/NotificationPreferences/get.js -- so this hook never needs a
// separate "what types exist" fetch.
export const useNotificationPreferencesQuery = () => {
  return useQuery({
    queryKey: queryKeys.notificationPreferences.all,
    queryFn: ({ signal }) => getNotificationPreferences(signal),
  });
};
