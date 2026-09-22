import api from "./axios";

// NOT-003-T02 -- thin wrapper over the notification-preferences routes,
// through the shared axios instance (auth refresh / 401/429 handling stays
// centralized there, same convention as recurringApi.js).

export const getNotificationPreferences = async (signal) => {
  const { data } = await api.get("/api/notification-preferences", { signal });
  return data;
};

// `updates` is a PARTIAL payload -- either or both of { types, quietHours }
// -- the backend only patches the sections actually present (see
// notificationPreferenceService.savePreferences's own comment on why a
// partial save does not freeze every other type's default).
export const updateNotificationPreferences = async (updates) => {
  const { data } = await api.put("/api/notification-preferences", updates);
  return data;
};
