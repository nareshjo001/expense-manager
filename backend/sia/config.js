// SIA configuration surface.
//
// M1-1 scope: pure environment-variable parsing into a small, safe-by-default
// configuration object. This module never validates or requires a real
// provider API key, never logs secrets, never mutates process.env, and never
// throws -- importing it with no SIA_* variables set is always safe and
// yields the documented defaults. See backend/sia/README.md.
"use strict";

const DEFAULT_TIMEOUT_MS = 8000;

// SIA_ENABLED is true only when its normalized (whitespace-trimmed) value is
// exactly the string "true" -- deliberately case-sensitive and exact, not a
// general "truthy string" parse, so an unexpected value (e.g. "1", "yes",
// "TRUE") fails closed to disabled rather than silently enabling SIA.
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

// Trims the configured model name; blank (or absent) input becomes null --
// the same closed/unconfigured representation normalizeProvider uses. There
// is deliberately no hardcoded default model: an unconfigured model must
// fail the same explicit way a missing provider does, not silently select a
// specific OpenAI model version.
function normalizeModel(rawValue) {
  if (typeof rawValue !== "string") {
    return null;
  }
  const trimmed = rawValue.trim();
  return trimmed === "" ? null : trimmed;
}

// Accepts the configured timeout only when it parses to a finite, strictly
// positive number. Anything else (absent, blank, non-numeric, zero,
// negative, Infinity/NaN) falls back to the safe default.
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
