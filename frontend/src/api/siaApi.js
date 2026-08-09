import api from "./axios";

// Sends a question to SIA, BALENISA's read-only financial explanation assistant.
//
// `sessionId` continues an existing conversation; `clientMessageId` is the
// idempotency key that lets a retry replay the original answer instead of
// invoking the LLM a second time (see backend/sia/idempotencyService.js).
// Both are optional and are omitted from the request body entirely when
// absent, preserving the original single-argument contract's payload shape
// for a first, unkeyed question.
//
// This layer deliberately does NOT generate the key -- the conversation
// state owns it, because a retry must resend the exact same key and only
// the caller knows whether a submission is a retry or a new question.
export const askSia = async ({ question, sessionId, clientMessageId } = {}) => {
  const payload = { question };
  if (sessionId) payload.sessionId = sessionId;
  if (clientMessageId) payload.clientMessageId = clientMessageId;

  const { data } = await api.post("/sia/ask", payload);
  return data;
};
