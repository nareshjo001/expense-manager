// SIA-001-T04 -- lightweight, in-process circuit breaker for LLM provider
// calls, the second half of "Add one safe retry and circuit-breaker
// behavior" (the retry half already existed: directAnswerService.js's
// askWithTransientRetry() retries exactly once on a transient 429/5xx
// response). This module is the missing circuit-breaker half.
//
// Only ONE chat provider is ever active per deployment (SIA_LLM_PROVIDER
// is a single flat string -- llmService.js's askLlm()), so in practice
// only one entry is ever tracked, but state is keyed by provider name
// defensively rather than assuming a singleton.
//
// Trips ONLY on failures that are genuine signals the PROVIDER ITSELF is
// unhealthy (timeout, HTTP error, network error, malformed/incomplete/
// empty response) -- never on a static configuration or input problem
// (missing model/API key, an unimplemented/unconfigured provider, an
// invalid structured-output request, or SIA-001-T02's own
// CONTEXT_BUDGET_EXCEEDED). Those fail identically on every call
// regardless of provider health, so counting them toward the breaker (or
// having a cooldown "fix" them) would be meaningless -- and per
// llmService.js's own design, none of them ever reach the adapter/network
// call in the first place.
//
// Classic three-state breaker: closed (normal) -> open (short-circuits
// every call immediately, no network attempt) -> half-open (one trial
// call allowed through once the cooldown elapses) -> closed on a
// successful trial, or open again with a fresh cooldown on a failed one.
// Entirely in-process, no external dependency -- same "cheap enough to
// leave on" philosophy utils/metrics.js already uses for its own
// in-memory aggregation, and it resets on every process restart, which is
// an accepted, deliberate simplification for a lightweight breaker, not a
// gap: a fresh process should not inherit a previous process's outage.
"use strict";

const config = require("./config");

// SIA-001-T02's CONTEXT_BUDGET_EXCEEDED and every "static" LlmProviderError
// code (PROVIDER_NOT_CONFIGURED, PROVIDER_NOT_IMPLEMENTED,
// MODEL_NOT_CONFIGURED, PROVIDER_API_KEY_NOT_CONFIGURED,
// STRUCTURED_OUTPUT_INVALID_REQUEST, PROVIDER_MALFORMED_STRUCTURED_OUTPUT)
// are deliberately NOT in this set -- see the module header.
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

// Returns true only while the breaker is genuinely OPEN and still inside
// its cooldown window. Once the cooldown has elapsed, this call itself
// performs the OPEN -> HALF-OPEN transition (no separate timer/interval
// needed) and returns false, allowing exactly the next call through as
// the trial -- askLlm() calls this immediately before invoking an
// adapter, so "allowed through" means "the adapter is actually called".
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

// Called once per actual adapter attempt (so once per askLlm() call --
// askWithTransientRetry()'s retry counts as its own, separate attempt).
// `isHealthSignal` should be computed via isProviderHealthSignalError()
// for a failure; ignored when `success` is true.
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

// Read-only introspection -- for tests and any future admin/status
// surface. Never mutates state (unlike isCircuitOpen(), which can perform
// the half-open transition as a side effect of being asked).
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
