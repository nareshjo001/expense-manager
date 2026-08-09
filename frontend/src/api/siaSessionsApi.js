import api from "./axios";

// Thin wrappers over the SIA conversation-session endpoints
// (backend/Routes/sia.routes.js). Response envelopes are returned
// unchanged; normalization belongs to the hooks/components that consume
// them.

// GET /sia/sessions -> { success, sessions: [{ sessionId, title,
// messageCount, lastMessageAt, createdAt, updatedAt }] }, ordered most
// recently updated first by the server.
export const getSiaSessions = async (signal) => {
  const { data } = await api.get("/sia/sessions", { signal });
  return data;
};

// GET /sia/sessions/:sessionId/messages -> { success, sessionId,
// messages: [{ role, content, intent, createdAt }] }, in ascending
// chronological order per the server's own contract.
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
