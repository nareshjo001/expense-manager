import api from "./axios";

// Sends a question to SIA, BALENISA's read-only financial explanation assistant.
export const askSia = async (question) => {
  const { data } = await api.post("/sia/ask", { question });
  return data;
};
