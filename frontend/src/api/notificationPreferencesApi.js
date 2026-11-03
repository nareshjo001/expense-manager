import api from "./axios";

// Js).

export const getNotificationPreferences = async (signal) => {
  const { data } = await api.get("/api/notification-preferences", { signal });
  return data;
};

// SavePreferences's own comment on why a partial save does not freeze every other type's default).
export const updateNotificationPreferences = async (updates) => {
  const { data } = await api.put("/api/notification-preferences", updates);
  return data;
};
