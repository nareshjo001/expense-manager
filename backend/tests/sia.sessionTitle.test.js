"use strict";

// Batch 3G: unit tests for the deterministic, local session-title

const { deriveSessionTitle, MAX_TITLE_LENGTH } = require("../sia/sessionTitle");

describe("deriveSessionTitle", () => {
  it("returns null for non-string input", () => {
    expect(deriveSessionTitle(undefined)).toBeNull();
    expect(deriveSessionTitle(null)).toBeNull();
    expect(deriveSessionTitle(123)).toBeNull();
    expect(deriveSessionTitle(true)).toBeNull();
    expect(deriveSessionTitle({})).toBeNull();
    expect(deriveSessionTitle([])).toBeNull();
  });

  it("collapses whitespace and control characters, and trims ends", () => {
    expect(deriveSessionTitle("  How is   my budget?\n")).toBe("How is my budget?");
  });

  it("collapses tabs, newlines, and mixed control characters into single spaces", () => {
    expect(deriveSessionTitle("Why\tdid\r\nmy   spending\tchange?")).toBe("Why did my spending change?");
  });

  it("preserves meaningful Unicode / Tamil script exactly", () => {
    const tamil = "தமிழில் என் செலவுகளை விளக்கவும்";
    expect(deriveSessionTitle(tamil)).toBe(tamil);
  });

  it("preserves emoji-only questions", () => {
    expect(deriveSessionTitle("💰📊")).toBe("💰📊");
  });

  it("preserves punctuation-heavy questions", () => {
    expect(deriveSessionTitle("??? !!! -- really?!")).toBe("??? !!! -- really?!");
  });

  it("treats angle-bracket/script-like text as inert normalized display text (no HTML interpretation)", () => {
    const input = "<script>alert(1)</script>";
    expect(deriveSessionTitle(input)).toBe(input);
  });

  it("preserves user casing", () => {
    expect(deriveSessionTitle("WHY did MY Budget Change")).toBe("WHY did MY Budget Change");
  });

  it("returns null for whitespace-only input", () => {
    expect(deriveSessionTitle("   \t\n   ")).toBeNull();
    expect(deriveSessionTitle("  ")).toBeNull(); // non-breaking spaces
  });

  it("returns null for control-character-only input", () => {
    expect(deriveSessionTitle(String.fromCharCode(0, 1, 2))).toBeNull();
    expect(deriveSessionTitle(String.fromCharCode(127))).toBeNull();
    expect(deriveSessionTitle(String.fromCharCode(140))).toBeNull(); // C1 control
  });

  it("returns null for an empty string", () => {
    expect(deriveSessionTitle("")).toBeNull();
  });

  it("leaves short, already-clean questions untouched", () => {
    expect(deriveSessionTitle("How is my budget?")).toBe("How is my budget?");
  });

  it("does not truncate text at or under the max length", () => {
    const exact = "a".repeat(MAX_TITLE_LENGTH);
    expect(deriveSessionTitle(exact)).toBe(exact);
    expect(deriveSessionTitle(exact).length).toBe(MAX_TITLE_LENGTH);
  });

  it("truncates oversized plain text with a trailing ellipsis, staying within the max length", () => {
    const long = "a".repeat(MAX_TITLE_LENGTH + 50);
    const result = deriveSessionTitle(long);
    expect(result.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(result.endsWith("…")).toBe(true);
  });

  it("truncates oversized emoji (surrogate-pair) text without splitting a surrogate pair", () => {
    const longEmoji = "😀".repeat(80); // 😀 x80, 160 code units
    const result = deriveSessionTitle(longEmoji);

    expect(result.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(result.endsWith("…")).toBe(true);

    for (let i = 0; i < result.length; i += 1) {
      const codeUnit = result.charCodeAt(i);
      const isHighSurrogate = codeUnit >= 0xd800 && codeUnit <= 0xdbff;
      if (isHighSurrogate) {
        const next = result.charCodeAt(i + 1);
        const nextIsLowSurrogate = next >= 0xdc00 && next <= 0xdfff;
        expect(nextIsLowSurrogate).toBe(true);
      }
    }
  });

  it("truncates oversized Tamil-script text safely within the max length", () => {
    const longTamil = "தமிழில் என் செலவுகளை விளக்கவும் ".repeat(6);
    const result = deriveSessionTitle(longTamil);
    expect(result.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(result.endsWith("…")).toBe(true);
  });

  it("does not leave a dangling space directly before the ellipsis when truncating", () => {
    const long = "word ".repeat(40); // lots of natural word boundaries near the cut
    const result = deriveSessionTitle(long);
    expect(result.endsWith(" …")).toBe(false);
  });

  it("is a pure function -- same input always yields the same output, no side effects", () => {
    const input = "Why did my spending change this month?";
    const first = deriveSessionTitle(input);
    const second = deriveSessionTitle(input);
    expect(first).toBe(second);
  });
});
