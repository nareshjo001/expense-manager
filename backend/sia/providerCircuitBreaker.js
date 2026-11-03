// Js's askWithTransientRetry() retries exactly once on a transient 429/5xx response).
"use strict";

const config = require("./config");

// T02's CONTEXT_BUDGET_EXCEEDED and every "static" LlmProviderError code (PROVIDER_NOT_CONFIGURED, PROVIDER_NOT_IMPLEMENTED, MODEL_NOT_CONFIGURED, PROVIDER_API_KEY_NOT_CONFIGURED, STRUCTURED_OUTPUT_INVALID_REQUEST, PROVIDER_MALFORMED_STRUCTURED_OUTPUT) are deliberately NOT in this set -- see the module header.
const HEALTH_SIGNAL_CODES = new Set([
  "PROVIDER_TIMEOUT",
  "PROVIDER_HTTP_ERROR",
  "PROVIDER_NETWORK_ERROR",
  "PROVIDER_MALFORMED_RESPONSE",
  "PROVIDER_EMPTY_OUTPUT",
  "PROVIDER_RESPONSE_INCOMPLETE",
]);

function isProviderHealthSignalError(error) {
  return Boolean(error && HEALTH_SIGNAL_CODES.has(error.code));
}

// provider name -> { consecutiveFailures, state: "closed"|"open"|"half-open", openedAt }
let breakerState = new Map();

function safeProviderKey(provider) {
  return typeof provider === "string" && provider.trim() !== "" ? provider.trim() : "unconfigured";
}

function getEntry(provider) {
  const key = safeProviderKey(provider);
  let entry = breakerState.get(key);
  if (!entry) {
    entry = { consecutiveFailures: 0, state: "closed", openedAt: null };
    breakerState.set(key, entry);
  }
  return entry;
}

function normalizedThreshold() {
  const configured = config.circuitBreakerFailureThreshold;
  return Number.isFinite(configured) && configured > 0 ? configured : 5;
}

function normalizedCooldownMs() {
  const configured = config.circuitBreakerCooldownMs;
  return Number.isFinite(configured) && configured > 0 ? configured : 30000;
}

// Returns true only while the breaker is genuinely OPEN and still inside its cooldown window.
function isCircuitOpen(provider) {
  const entry = getEntry(provider);
  if (entry.state !== "open") return false;

  const elapsedMs = Date.now() - entry.openedAt;
  if (elapsedMs >= normalizedCooldownMs()) {
    entry.state = "half-open";
    return false;
  }
  return true;
}

// Called once per actual adapter attempt (so once per askLlm() call -- askWithTransientRetry()'s retry counts as its own, separate attempt).
function recordOutcome(provider, { success, isHealthSignal } = {}) {
  const entry = getEntry(provider);

  if (success) {
    entry.consecutiveFailures = 0;
    entry.state = "closed";
    entry.openedAt = null;
    return;
  }

  if (!isHealthSignal) {
    // A static config/input failure -- never attempted the provider, so
    // it says nothing about provider health. Leave the breaker untouched.
    return;
  }

  entry.consecutiveFailures += 1;

  if (entry.state === "half-open") {
    // The post-cooldown trial call failed too -- reopen immediately with
    // a fresh cooldown, regardless of the raw consecutive-failure count.
    entry.state = "open";
    entry.openedAt = Date.now();
    return;
  }

  if (entry.consecutiveFailures >= normalizedThreshold()) {
    entry.state = "open";
    entry.openedAt = Date.now();
  }
}

// Read-only introspection -- for tests and any future admin/status surface.
function getCircuitState(provider) {
  const entry = breakerState.get(safeProviderKey(provider));
  if (!entry) return { state: "closed", consecutiveFailures: 0, openedAt: null };
  return { ...entry };
}

function resetCircuitBreakerForTests() {
  breakerState = new Map();
}

module.exports = {
  isCircuitOpen,
  recordOutcome,
  isProviderHealthSignalError,
  getCircuitState,
  resetCircuitBreakerForTests,
};
