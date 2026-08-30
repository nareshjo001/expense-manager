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

// The application's canonical IANA time zone for calendar/period
// resolution (sia/periodResolver.js) -- deliberately NEVER the server
// process's own host/local time zone, since that is an unrelated
// deployment detail. Defaults to "Asia/Kolkata" (documented default, per
// BALENISA's primary user base) when unset/blank/invalid. Validated with
// Intl.DateTimeFormat itself (no new dependency) -- an unsupported/
// malformed zone name falls back to the default rather than throwing
// later, deep inside period resolution.
const DEFAULT_APP_TIME_ZONE = "Asia/Kolkata";

function normalizeAppTimeZone(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    return DEFAULT_APP_TIME_ZONE;
  }
  const trimmed = rawValue.trim();
  try {
    // Throws a RangeError for an unrecognized IANA zone name -- the only
    // validation Node's built-in Intl support can give us without a new
    // dependency, but sufficient to reject typos/garbage.
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return trimmed;
  } catch (_err) {
    return DEFAULT_APP_TIME_ZONE;
  }
}

// ---------------------------------------------------------------------
// Voice input (SIA speech-to-text) -- additive, independent of the text
// SIA_LLM_* surface above. Unlike SIA_LLM_PROVIDER/SIA_LLM_MODEL (which
// default to null so an unconfigured text provider fails loudly and
// explicitly), SIA_STT_PROVIDER/SIA_STT_MODEL default to a real,
// documented provider+model ("groq"/"whisper-large-v3-turbo") so voice
// input has a sensible out-of-the-box configuration once SIA_VOICE_ENABLED
// is turned on -- readiness.js's isVoiceReady() is still the sole gate on
// whether a request may actually be served (it additionally requires a
// real credential), exactly mirroring isSiaReady()'s separation of
// "configured" from "ready".
const DEFAULT_STT_PROVIDER = "groq";
const DEFAULT_STT_MODEL = "whisper-large-v3-turbo";
const DEFAULT_STT_TIMEOUT_MS = 30000;
const DEFAULT_STT_MAX_BYTES = 5242880;
const DEFAULT_STT_MAX_DURATION_SECONDS = 45;

function normalizeSttProvider(rawValue) {
  if (typeof rawValue !== "string") {
    return DEFAULT_STT_PROVIDER;
  }
  const trimmed = rawValue.trim();
  return trimmed === "" ? DEFAULT_STT_PROVIDER : trimmed;
}

function normalizeSttModel(rawValue) {
  if (typeof rawValue !== "string") {
    return DEFAULT_STT_MODEL;
  }
  const trimmed = rawValue.trim();
  return trimmed === "" ? DEFAULT_STT_MODEL : trimmed;
}

function normalizeSttTimeoutMs(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    return DEFAULT_STT_TIMEOUT_MS;
  }
  const parsed = Number(rawValue.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_STT_TIMEOUT_MS;
  }
  return parsed;
}

// Accepts only a finite, strictly positive byte ceiling -- anything else
// (missing, blank, non-numeric, zero, negative) falls back to the
// documented 5 MiB default rather than disabling the size check.
function normalizeSttMaxBytes(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    return DEFAULT_STT_MAX_BYTES;
  }
  const parsed = Number(rawValue.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_STT_MAX_BYTES;
  }
  return parsed;
}

// Same validation shape as normalizeSttMaxBytes, for the documented
// 45-second default clip-length ceiling.
function normalizeSttMaxDurationSeconds(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") {
    return DEFAULT_STT_MAX_DURATION_SECONDS;
  }
  const parsed = Number(rawValue.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_STT_MAX_DURATION_SECONDS;
  }
  return parsed;
}

const config = {
  enabled: normalizeEnabled(process.env.SIA_ENABLED),
  provider: normalizeProvider(process.env.SIA_LLM_PROVIDER),
  timeoutMs: normalizeTimeoutMs(process.env.SIA_LLM_TIMEOUT_MS),
  model: normalizeModel(process.env.SIA_LLM_MODEL),
  appTimeZone: normalizeAppTimeZone(process.env.APP_TIME_ZONE),
  // Voice input (Workstream 2) -- additive fields only, read the same
  // fail-safe way as everything above: importing with none of these
  // SIA_VOICE_*/SIA_STT_* variables set is always safe and yields the
  // documented defaults, never a thrown error.
  voiceEnabled: normalizeEnabled(process.env.SIA_VOICE_ENABLED),
  sttProvider: normalizeSttProvider(process.env.SIA_STT_PROVIDER),
  sttModel: normalizeSttModel(process.env.SIA_STT_MODEL),
  sttTimeoutMs: normalizeSttTimeoutMs(process.env.SIA_STT_TIMEOUT_MS),
  sttMaxBytes: normalizeSttMaxBytes(process.env.SIA_STT_MAX_BYTES),
  sttMaxDurationSeconds: normalizeSttMaxDurationSeconds(process.env.SIA_STT_MAX_DURATION_SECONDS),
};

module.exports = config;
