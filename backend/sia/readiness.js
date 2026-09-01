// SIA runtime-readiness evaluation -- the single authoritative "can SIA answer a new question right now?" check, called by both GET /sia/status and POST /sia/ask so neither can diverge. Purely local/synchronous/deterministic: no network, provider, or DNS call, so "ready" means "correctly configured", never "verified working" -- a request that passes can still legitimately hit a 503 later (see llmService.js's PROVIDER_* codes). The credential is read only to test presence, never logged, returned, or format-validated.
"use strict";

const config = require("./config");

// Providers this codebase actually implements an adapter for -- kept in sync with llmService.js's askLlm() dispatch (which throws PROVIDER_NOT_IMPLEMENTED for anything else), so this module can never advertise readiness for a provider ask.js can't actually serve.
const IMPLEMENTED_PROVIDERS = Object.freeze(["openai", "gemini", "groq"]);

// Which environment variable holds the credential for each implemented
const CREDENTIAL_ENV_VAR_BY_PROVIDER = Object.freeze({
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
});

// Mirrors llmService.js's own isBlank(): null, undefined, a non-string, and a whitespace-only string all count as "not configured".
function isBlank(value) {
  return typeof value !== "string" || value.trim() === "";
}

function normalizedProvider() {
  const provider = config.provider;
  return typeof provider === "string" ? provider.trim() : provider;
}

/* Evaluates local SIA configuration readiness. */
function isSiaReady() {
  // 1. Feature flag -- config.js already fails closed for anything other than the exact string "true".
  if (config.enabled !== true) return false;

  // 2. Provider must be configured and implemented here, same as llmService.js treats it.
  const provider = normalizedProvider();
  if (isBlank(provider)) return false;
  if (!IMPLEMENTED_PROVIDERS.includes(provider)) return false;

  // 3. Model -- llmService.js's askOpenAi()/askGemini()/askGroq() throw MODEL_NOT_CONFIGURED for a blank model, and config.js supplies no default.
  if (isBlank(config.model)) return false;

  // 4. Credential presence only, read directly from process.env (never the shared config object) to keep the secret off the widely-imported config surface. The env-var NAME itself is looked up from CREDENTIAL_ENV_VAR_BY_PROVIDER so this generalizes to any future implemented provider without another hardcoded branch here.
  const credentialEnvVar = CREDENTIAL_ENV_VAR_BY_PROVIDER[provider];
  if (credentialEnvVar && isBlank(process.env[credentialEnvVar])) return false;

  return true;
}

// ---------------------------------------------------------------------

// Providers this codebase implements an STT adapter for -- kept in sync
const IMPLEMENTED_STT_PROVIDERS = Object.freeze(["groq"]);

// Which environment variable holds the credential for each implemented STT
const STT_CREDENTIAL_ENV_VAR_BY_PROVIDER = Object.freeze({
  groq: "GROQ_API_KEY",
});

function normalizedSttProvider() {
  const provider = config.sttProvider;
  return typeof provider === "string" ? provider.trim() : provider;
}

/* Evaluates local SIA voice-input (speech-to-text) configuration */
function isVoiceReady() {
  // 1. Feature flag -- independent of SIA_ENABLED/config.enabled.
  if (config.voiceEnabled !== true) return false;

  // 2. Provider must be configured and implemented here.
  const provider = normalizedSttProvider();
  if (isBlank(provider)) return false;
  if (!IMPLEMENTED_STT_PROVIDERS.includes(provider)) return false;

  // 3. Credential presence only, read directly from process.env, never the
  const credentialEnvVar = STT_CREDENTIAL_ENV_VAR_BY_PROVIDER[provider];
  if (credentialEnvVar && isBlank(process.env[credentialEnvVar])) return false;

  return true;
}

module.exports = {
  isSiaReady,
  IMPLEMENTED_PROVIDERS,
  isVoiceReady,
  IMPLEMENTED_STT_PROVIDERS,
};
