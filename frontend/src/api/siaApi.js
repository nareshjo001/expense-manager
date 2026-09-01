import api from "./axios";

// Sends a question to SIA, BALENISA's read-only financial explanation assistant.
export const askSia = async ({ question, sessionId, clientMessageId } = {}) => {
  const payload = { question };
  if (sessionId) payload.sessionId = sessionId;
  if (clientMessageId) payload.clientMessageId = clientMessageId;

  const { data } = await api.post("/sia/ask", payload);
  return data;
};
