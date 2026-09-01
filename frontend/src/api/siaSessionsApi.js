import api from "./axios";

// Thin wrappers over the SIA conversation-session endpoints

// GET /sia/sessions -> { success, sessions: [{ sessionId, title,
export const getSiaSessions = async (signal) => {
  const { data } = await api.get("/sia/sessions", { signal });
  return data;
};

// GET /sia/sessions/:sessionId/messages -> { success, sessionId,
export const getSiaSessionMessages = async (sessionId, signal) => {
  const { data } = await api.get(`/sia/sessions/${encodeURIComponent(sessionId)}/messages`, { signal });
  return data;
};

// DELETE /sia/sessions/:sessionId -> { success, message }. Deletes one
// conversation thread and its messages; never any financial data.
export const deleteSiaSession = async (sessionId) => {
  const { data } = await api.delete(`/sia/sessions/${encodeURIComponent(sessionId)}`);
  return data;
};

// GET /sia/status -> { success, available } -- Batch 3E. Tells the client
export const getSiaStatus = async (signal) => {
  const { data } = await api.get("/sia/status", { signal });
  return data;
};
