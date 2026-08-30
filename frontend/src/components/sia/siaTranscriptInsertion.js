import { MAX_QUESTION_LENGTH } from "./useSiaConversation";

// Workstream 3, part C -- merges a voice transcript into the composer's
// EXISTING draft text exactly once, choosing a documented, tested behavior
// for the 500-character boundary rather than silently truncating.
//
// Decision: if the combined text would exceed the composer's existing
// MAX_QUESTION_LENGTH limit (the same limit/normalization SiaPanel.js's
// own `isOverLimit` already uses -- trimmed length), the insert is
// REJECTED outright and the composer's current value is left completely
// untouched. The caller (SiaPanel.js) surfaces `error` in an inline,
// accessible message so the user can see why nothing changed and decide
// what to do (send what they have, then record a follow-up; or clear the
// composer first) -- never a silent truncation that quietly drops words
// from the middle or end of a spoken question.
//
// Draft preservation: existing composer text is never overwritten. An
// empty/whitespace-only existing draft is replaced by the transcript
// alone; a non-empty draft gets the transcript appended after a single
// space separator (never a double space, never eating the existing text's
// own trailing whitespace twice).
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
