import { MAX_QUESTION_LENGTH } from "./useSiaConversation";

// Workstream 3, part C -- merges a voice transcript into the composer's
export const SIA_TRANSCRIPT_TOO_LONG_MESSAGE =
  "Your voice input is too long to add to the current question. Send what you have, or clear the question box first, then try recording again.";

export function insertTranscriptIntoComposer(existingInput, transcript) {
  const cleanTranscript = typeof transcript === "string" ? transcript.trim() : "";
  const currentInput = typeof existingInput === "string" ? existingInput : "";

  if (cleanTranscript === "") {
    return { ok: true, value: currentInput };
  }

  const hasExistingDraft = currentInput.trim() !== "";
  const merged = hasExistingDraft ? `${currentInput.trim()} ${cleanTranscript}` : cleanTranscript;

  if (merged.trim().length > MAX_QUESTION_LENGTH) {
    return { ok: false, value: currentInput, error: SIA_TRANSCRIPT_TOO_LONG_MESSAGE };
  }

  return { ok: true, value: merged };
}

export default insertTranscriptIntoComposer;
