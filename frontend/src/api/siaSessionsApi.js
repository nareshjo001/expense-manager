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

// GET /sia/status -> { success, available } -- Batch 3E. Tells the client
// whether SIA can accept a NEW question right now, so the composer can be
// disabled up front instead of the user discovering a misconfigured
// deployment only from a failed answer.
//
// The server's contract is deliberately minimal (see
// backend/Controllers/SiaControllers/status.js): it carries no provider
// name, model, credential hint, environment-variable name, or reason code,
// so there is nothing sensitive here to accidentally render. As with the
// wrappers above, the envelope is returned unchanged -- validation belongs
// to the hook that consumes it.
export const getSiaStatus = async (signal) => {
  const { data } = await api.get("/sia/status", { signal });
  return data;
};
