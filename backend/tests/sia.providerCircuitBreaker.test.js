// Unit tests for backend/sia/providerCircuitBreaker.js (SIA-001-T04).
"use strict";

function loadBreaker(configOverrides = {}) {
  jest.resetModules();
  jest.doMock("../sia/config", () => ({
    circuitBreakerFailureThreshold: 3,
    circuitBreakerCooldownMs: 50,
    ...configOverrides,
  }));
  return require("../sia/providerCircuitBreaker");
}

afterEach(() => {
  jest.resetModules();
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("backend/sia/providerCircuitBreaker", () => {
  describe("isProviderHealthSignalError", () => {
    it.each([
      "PROVIDER_TIMEOUT",
      "PROVIDER_HTTP_ERROR",
      "PROVIDER_NETWORK_ERROR",
      "PROVIDER_MALFORMED_RESPONSE",
      "PROVIDER_EMPTY_OUTPUT",
      "PROVIDER_RESPONSE_INCOMPLETE",
    ])("treats %s as a provider-health signal", (code) => {
      const breaker = loadBreaker();
      expect(breaker.isProviderHealthSignalError({ code })).toBe(true);
    });

    it.each([
      "PROVIDER_NOT_CONFIGURED",
      "PROVIDER_NOT_IMPLEMENTED",
      "MODEL_NOT_CONFIGURED",
      "PROVIDER_API_KEY_NOT_CONFIGURED",
      "STRUCTURED_OUTPUT_INVALID_REQUEST",
      "PROVIDER_MALFORMED_STRUCTURED_OUTPUT",
      "CONTEXT_BUDGET_EXCEEDED",
      undefined,
    ])("does NOT treat %s as a provider-health signal (static config/input problem)", (code) => {
      const breaker = loadBreaker();
      expect(breaker.isProviderHealthSignalError({ code })).toBe(false);
    });

    it("returns false for a non-error/null/undefined value", () => {
      const breaker = loadBreaker();
      expect(breaker.isProviderHealthSignalError(null)).toBe(false);
      expect(breaker.isProviderHealthSignalError(undefined)).toBe(false);
    });
  });

  describe("closed state (default)", () => {
    it("starts closed for an unknown provider", () => {
      const breaker = loadBreaker();
      expect(breaker.isCircuitOpen("openai")).toBe(false);
      expect(breaker.getCircuitState("openai")).toMatchObject({ state: "closed", consecutiveFailures: 0 });
    });

    it("stays closed after fewer health-signal failures than the threshold", () => {
      const breaker = loadBreaker({ circuitBreakerFailureThreshold: 3 });
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      expect(breaker.isCircuitOpen("openai")).toBe(false);
      expect(breaker.getCircuitState("openai").consecutiveFailures).toBe(2);
    });

    it("a success resets the consecutive-failure count to 0", () => {
      const breaker = loadBreaker({ circuitBreakerFailureThreshold: 3 });
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      breaker.recordOutcome("openai", { success: true });
      expect(breaker.getCircuitState("openai")).toMatchObject({ state: "closed", consecutiveFailures: 0 });
      // Two more failures after the reset still isn't enough to open it.
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      expect(breaker.isCircuitOpen("openai")).toBe(false);
    });

    it("a non-health-signal failure never counts toward the threshold, however many times it happens", () => {
      const breaker = loadBreaker({ circuitBreakerFailureThreshold: 2 });
      for (let i = 0; i < 10; i += 1) {
        breaker.recordOutcome("openai", { success: false, isHealthSignal: false });
      }
      expect(breaker.isCircuitOpen("openai")).toBe(false);
      expect(breaker.getCircuitState("openai")).toMatchObject({ state: "closed", consecutiveFailures: 0 });
    });
  });

  describe("opening", () => {
    it("opens once consecutive health-signal failures reach the configured threshold", () => {
      const breaker = loadBreaker({ circuitBreakerFailureThreshold: 3 });
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      expect(breaker.isCircuitOpen("openai")).toBe(false);
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      expect(breaker.isCircuitOpen("openai")).toBe(true);
      expect(breaker.getCircuitState("openai").state).toBe("open");
    });

    it("is scoped per provider -- opening one provider never affects another", () => {
      const breaker = loadBreaker({ circuitBreakerFailureThreshold: 2 });
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      expect(breaker.isCircuitOpen("openai")).toBe(true);
      expect(breaker.isCircuitOpen("gemini")).toBe(false);
    });
  });

  describe("half-open transition and recovery", () => {
    it("stays open before the cooldown elapses", async () => {
      const breaker = loadBreaker({ circuitBreakerFailureThreshold: 1, circuitBreakerCooldownMs: 5000 });
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      expect(breaker.isCircuitOpen("openai")).toBe(true);
      await delay(10);
      expect(breaker.isCircuitOpen("openai")).toBe(true);
    });

    it("allows exactly one trial call through after the cooldown elapses, and a successful trial closes it", async () => {
      const breaker = loadBreaker({ circuitBreakerFailureThreshold: 1, circuitBreakerCooldownMs: 30 });
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      expect(breaker.isCircuitOpen("openai")).toBe(true);

      await delay(50);

      expect(breaker.isCircuitOpen("openai")).toBe(false);
      expect(breaker.getCircuitState("openai").state).toBe("half-open");

      breaker.recordOutcome("openai", { success: true });
      expect(breaker.getCircuitState("openai")).toMatchObject({ state: "closed", consecutiveFailures: 0 });
      expect(breaker.isCircuitOpen("openai")).toBe(false);
    });

    it("a failed trial call reopens the breaker immediately with a fresh cooldown, regardless of threshold", async () => {
      const breaker = loadBreaker({ circuitBreakerFailureThreshold: 5, circuitBreakerCooldownMs: 30 });
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      expect(breaker.isCircuitOpen("openai")).toBe(true);

      await delay(50);
      expect(breaker.isCircuitOpen("openai")).toBe(false); // half-open trial allowed

      // The trial itself fails -- reopens immediately, NOT waiting for 5
      // more consecutive failures.
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      expect(breaker.isCircuitOpen("openai")).toBe(true);
    });
  });

  describe("resetCircuitBreakerForTests", () => {
    it("clears all tracked provider state", () => {
      const breaker = loadBreaker({ circuitBreakerFailureThreshold: 1 });
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      expect(breaker.isCircuitOpen("openai")).toBe(true);

      breaker.resetCircuitBreakerForTests();

      expect(breaker.isCircuitOpen("openai")).toBe(false);
      expect(breaker.getCircuitState("openai")).toMatchObject({ state: "closed", consecutiveFailures: 0 });
    });
  });

  describe("defensive defaults (mirrors config.js's own safe-default behavior)", () => {
    it("falls back to a threshold of 5 when config.circuitBreakerFailureThreshold is missing/invalid", () => {
      const breaker = loadBreaker({ circuitBreakerFailureThreshold: undefined });
      for (let i = 0; i < 4; i += 1) {
        breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      }
      expect(breaker.isCircuitOpen("openai")).toBe(false);
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      expect(breaker.isCircuitOpen("openai")).toBe(true);
    });

    it("falls back to a cooldown of 30000ms when config.circuitBreakerCooldownMs is missing/invalid", async () => {
      const breaker = loadBreaker({ circuitBreakerFailureThreshold: 1, circuitBreakerCooldownMs: null });
      breaker.recordOutcome("openai", { success: false, isHealthSignal: true });
      expect(breaker.isCircuitOpen("openai")).toBe(true);
      await delay(20);
      // Nowhere near the 30s default -- still open.
      expect(breaker.isCircuitOpen("openai")).toBe(true);
    });
  });
});
