// siaTranscriptInsertion.js imports MAX_QUESTION_LENGTH from
// useSiaConversation.js, whose own module graph reaches the shared axios
// instance (frontend/src/api/axios.js) via useSiaAskMutation/siaApi.js.
// axios ships as ESM and CRA's Jest config does not transform node_modules,
// so -- matching this repository's established convention (see
// siaApi.test.js/SiaPanel.test.js) -- the API layer is mocked here purely
// to keep the real axios package out of this test file's module graph;
// nothing in this file ever calls askSia.
jest.mock("../../api/siaApi", () => ({ askSia: jest.fn() }));

import { insertTranscriptIntoComposer, SIA_TRANSCRIPT_TOO_LONG_MESSAGE } from "./siaTranscriptInsertion";
import { MAX_QUESTION_LENGTH } from "./useSiaConversation";

describe("frontend/src/components/sia/siaTranscriptInsertion insertTranscriptIntoComposer", () => {
  it("replaces an empty draft with the transcript alone", () => {
    const result = insertTranscriptIntoComposer("", "why did my spending change");
    expect(result).toEqual({ ok: true, value: "why did my spending change" });
  });

  it("replaces a whitespace-only draft with the transcript alone", () => {
    const result = insertTranscriptIntoComposer("   ", "why did my spending change");
    expect(result).toEqual({ ok: true, value: "why did my spending change" });
  });

  it("appends to an existing draft with a single space separator, preserving both", () => {
    const result = insertTranscriptIntoComposer("What about", "my budget status");
    expect(result).toEqual({ ok: true, value: "What about my budget status" });
  });

  it("never double-spaces when the existing draft has trailing whitespace", () => {
    const result = insertTranscriptIntoComposer("What about   ", "my budget status");
    expect(result.value).toBe("What about my budget status");
  });

  it("trims transcript-side whitespace before merging", () => {
    const result = insertTranscriptIntoComposer("Hello", "   world  ");
    expect(result.value).toBe("Hello world");
  });

  it("a blank/empty transcript leaves the existing draft completely unchanged", () => {
    const result = insertTranscriptIntoComposer("Existing draft", "   ");
    expect(result).toEqual({ ok: true, value: "Existing draft" });
  });

  it("rejects the insert (leaving the draft untouched) when the combined length exceeds the 500-character limit", () => {
    const existing = "x".repeat(490);
    const transcript = "y".repeat(20);
    const result = insertTranscriptIntoComposer(existing, transcript);

    expect(result.ok).toBe(false);
    expect(result.value).toBe(existing);
    expect(result.error).toBe(SIA_TRANSCRIPT_TOO_LONG_MESSAGE);
  });

  it("accepts a merge that lands exactly at the 500-character boundary", () => {
    const existing = "x".repeat(490);
    const transcript = "y".repeat(9); // 490 + 1 (space) + 9 = 500
    const result = insertTranscriptIntoComposer(existing, transcript);

    expect(result.ok).toBe(true);
    expect(result.value.length).toBe(MAX_QUESTION_LENGTH);
  });

  it("rejects a transcript-only insert that alone exceeds the 500-character limit", () => {
    const transcript = "z".repeat(501);
    const result = insertTranscriptIntoComposer("", transcript);

    expect(result.ok).toBe(false);
    expect(result.value).toBe("");
  });

  it("treats non-string existingInput defensively as an empty draft", () => {
    const result = insertTranscriptIntoComposer(undefined, "hello");
    expect(result).toEqual({ ok: true, value: "hello" });
  });
});
