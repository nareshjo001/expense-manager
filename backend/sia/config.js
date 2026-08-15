// SIA configuration surface -- pure environment-variable parsing into a small, safe-by-default object. Never validates/requires a real provider API key, never logs secrets, never mutates process.env, never throws -- importing with no SIA_* variables set is always safe and yields documented defaults. See sia/README.md.
"use strict";

const DEFAULT_TIMEOUT_MS = 8000;

// SIA_ENABLED is true only when its trimmed value is exactly "true" -- case-sensitive and exact, not a general truthy parse, so an unexpected value fails closed to disabled.
function normalizeEnabled(rawValue) {
  if (typeof rawValue !== "string") {
    return false;
  }
  return rawValue.trim() === "true";
}

// Trims the provider name; blank (or absent) input becomes null, never an
// empty string.
function normalizeProvider(rawValue) {
  if (typeof rawValue !== "string") {
    return null;
  }
  const trimmed = rawValue.trim();
  return trimmed === "" ? null : trimmed;
}

// Trims the configured model name; blank/absent becomes null, same as normalizeProvider. No hardcoded default model -- an unconfigured model must fail the same explicit way a missing provider does, never silently select a version.
function normalizeModel(rawValue) {
  if (typeof rawValue !== "string") {
    return null;
  }
  const trimmed = rawValue.trim();
  return trimmed === "" ? null : trimmed;
}

// Accepts the configured timeout only when it parses to a finite, strictly positive number -- anything else falls back to the safe default.
function normalizeTimeoutMs(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    return DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number(rawValue.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return parsed;
}

const config = {
  enabled: normalizeEnabled(process.env.SIA_ENABLED),
  provider: normalizeProvider(process.env.SIA_LLM_PROVIDER),
  timeoutMs: normalizeTimeoutMs(process.env.SIA_LLM_TIMEOUT_MS),
  model: normalizeModel(process.env.SIA_LLM_MODEL),
};

module.exports = config;
