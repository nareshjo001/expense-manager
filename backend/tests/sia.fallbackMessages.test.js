// SIA-001-T07 -- exhaustive unit-level proof of fallbackMessages.js's
// code-to-category mapping, for every LlmProviderError code this codebase
// actually throws (llmService.js, providerCircuitBreaker.js). This is
// intentionally a fast, no-DB, no-app-boot unit test rather than N more
// full supertest-through-the-real-route runs: the route-level wiring
// itself (that ask.js correctly calls classifyProviderError()+
// responseFor() and returns exactly their result) is already proven
// end-to-end by sia.ask.directAnswerFallback.test.js for a representative
// sample (a health-signal code, the context-budget code, and a generic
// non-LlmProviderError). What THAT file does not attempt is exhaustive
// per-code coverage of the classification table itself -- that is this
// file's job, and doing it here (milliseconds per case) instead of via
// ~13 more ~20-30s real-app route runs is a deliberate cost/benefit call,
// not a shortcut around real coverage: every code is proven, just at the
// layer where proving it is cheap.
"use strict";

const { CATEGORY, classifyProviderError, responseFor } = require("../sia/fallbackMessages");
const { LlmProviderError } = require("../sia/llmService");
const providerCircuitBreaker = require("../sia/providerCircuitBreaker");

function errorWithCode(code, message = "boom") {
  return new LlmProviderError(message, { code, provider: "groq" });
}

// "provider" itself is a safe, generic word the fallback copy legitimately
// uses ("SIA couldn't reach its AI provider") -- what must never leak is the
// SPECIFIC provider name, the raw error message, or any technical detail.
const LEAK_CHECK_FIELDS = ["groq", "boom", "httpStatus", "stack"];

function assertNoLeakage(body) {
  const serialized = JSON.stringify(body);
  for (const field of LEAK_CHECK_FIELDS) {
    expect(serialized.toLowerCase()).not.toContain(field.toLowerCase());
  }
}

describe("fallbackMessages -- RETRY_SHORTLY codes (transient provider-health signals)", () => {
  const RETRY_SHORTLY_CODES = [
    "PROVIDER_TIMEOUT",
    "PROVIDER_HTTP_ERROR",
    "PROVIDER_NETWORK_ERROR",
    "PROVIDER_MALFORMED_RESPONSE",
    "PROVIDER_EMPTY_OUTPUT",
    "PROVIDER_RESPONSE_INCOMPLETE",
    "PROVIDER_CIRCUIT_OPEN",
  ];

  it.each(RETRY_SHORTLY_CODES)("%s classifies as RETRY_SHORTLY (503)", (code) => {
    const category = classifyProviderError(errorWithCode(code));
    expect(category).toBe(CATEGORY.RETRY_SHORTLY);

    const { status, body } = responseFor(category);
    expect(status).toBe(503);
    expect(body).toEqual({ success: false, code: "RETRY_SHORTLY", message: expect.any(String) });
    assertNoLeakage(body);
  });

  it("every RETRY_SHORTLY code here matches providerCircuitBreaker.js's own health-signal set exactly, except PROVIDER_CIRCUIT_OPEN itself", () => {
    // Deliberate design coupling (see fallbackMessages.js's own comment):
    // the codes that count as evidence a provider is unhealthy for breaker
    // purposes are the same codes told to the user as "try again shortly".
    // This test fails loudly if the two lists are ever edited independently.
    const breakerHealthSignals = RETRY_SHORTLY_CODES.filter((c) => c !== "PROVIDER_CIRCUIT_OPEN");
    for (const code of breakerHealthSignals) {
      expect(providerCircuitBreaker.isProviderHealthSignalError(errorWithCode(code))).toBe(true);
    }
  });
});

describe("fallbackMessages -- QUESTION_TOO_COMPLEX (context budget)", () => {
  it("CONTEXT_BUDGET_EXCEEDED classifies as QUESTION_TOO_COMPLEX (422)", () => {
    const category = classifyProviderError(errorWithCode("CONTEXT_BUDGET_EXCEEDED"));
    expect(category).toBe(CATEGORY.QUESTION_TOO_COMPLEX);

    const { status, body } = responseFor(category);
    expect(status).toBe(422);
    expect(body).toEqual({ success: false, code: "QUESTION_TOO_COMPLEX", message: expect.any(String) });
    assertNoLeakage(body);
    // Actionable without disclosing the actual configured character/token
    // ceiling (SIA-001-T01's non-disclosure posture).
    expect(body.message).not.toMatch(/\d{3,}/);
  });
});

describe("fallbackMessages -- UNAVAILABLE (every static/config code, and anything unrecognized)", () => {
  const STATIC_CONFIG_CODES = [
    "PROVIDER_NOT_CONFIGURED",
    "PROVIDER_NOT_IMPLEMENTED",
    "MODEL_NOT_CONFIGURED",
    "PROVIDER_API_KEY_NOT_CONFIGURED",
    "STRUCTURED_OUTPUT_INVALID_REQUEST",
    "PROVIDER_MALFORMED_STRUCTURED_OUTPUT",
    // The axios-error normalizer's own catch-all (llmService.js's
    // normalizeAxiosError -- neither err.response nor err.request present,
    // e.g. a request-construction failure). Deliberately NOT a health
    // signal for the circuit breaker either (providerCircuitBreaker.js's
    // HEALTH_SIGNAL_CODES excludes it too) -- this is a request-building
    // problem, not evidence the provider itself is degrading, so retrying
    // it or counting it toward an outage is the wrong instinct either way.
    "PROVIDER_REQUEST_FAILED",
  ];

  it.each(STATIC_CONFIG_CODES)("%s classifies as UNAVAILABLE (503), and is NOT a circuit-breaker health signal", (code) => {
    const category = classifyProviderError(errorWithCode(code));
    expect(category).toBe(CATEGORY.UNAVAILABLE);
    expect(providerCircuitBreaker.isProviderHealthSignalError(errorWithCode(code))).toBe(false);

    const { status, body } = responseFor(category);
    expect(status).toBe(503);
    expect(body).toEqual({ success: false, code: "UNAVAILABLE", message: expect.any(String) });
    assertNoLeakage(body);
  });

  it("an unrecognized/unknown code classifies as UNAVAILABLE", () => {
    const category = classifyProviderError(errorWithCode("SOME_FUTURE_CODE_NOBODY_WROTE_A_CASE_FOR"));
    expect(category).toBe(CATEGORY.UNAVAILABLE);
  });

  it("a plain Error with no .code classifies as UNAVAILABLE, without inspecting the message", () => {
    const category = classifyProviderError(new Error("some internal structural failure with a stack trace"));
    expect(category).toBe(CATEGORY.UNAVAILABLE);

    const { body } = responseFor(category);
    expect(JSON.stringify(body)).not.toContain("structural failure");
  });

  it("null/undefined/non-error input classifies as UNAVAILABLE without throwing", () => {
    expect(classifyProviderError(null)).toBe(CATEGORY.UNAVAILABLE);
    expect(classifyProviderError(undefined)).toBe(CATEGORY.UNAVAILABLE);
    expect(classifyProviderError("not an error object")).toBe(CATEGORY.UNAVAILABLE);
  });
});

describe("fallbackMessages -- responseFor() defensive fallback", () => {
  it("an invalid/garbage category still returns the UNAVAILABLE response rather than throwing or returning undefined", () => {
    const { status, body } = responseFor("NOT_A_REAL_CATEGORY");
    expect(status).toBe(503);
    expect(body).toEqual({ success: false, code: "UNAVAILABLE", message: expect.any(String) });
  });

  it("every CATEGORY value has a corresponding RESPONSES entry with a status and a body.code matching the category", () => {
    for (const category of Object.values(CATEGORY)) {
      const { status, body } = responseFor(category);
      expect(typeof status).toBe("number");
      expect(body.code).toBe(category);
      expect(body.success).toBe(false);
      expect(typeof body.message).toBe("string");
      expect(body.message.length).toBeGreaterThan(0);
    }
  });
});

describe("fallbackMessages -- SIA_DISABLED_BY_USER (SIA-001-T06's reserved category)", () => {
  it("is a real, complete response entry even though classifyProviderError() never produces it (ask.js's own SIA-001-T06 gate returns it directly)", () => {
    const { status, body } = responseFor(CATEGORY.SIA_DISABLED_BY_USER);
    expect(status).toBe(403);
    expect(body).toEqual({ success: false, code: "SIA_DISABLED_BY_USER", message: expect.any(String) });
  });
});
