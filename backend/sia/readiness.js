// SIA runtime-readiness evaluation -- the single authoritative "can SIA answer a new question right now?" check, called by both GET /sia/status and POST /sia/ask so neither can diverge. Purely local/synchronous/deterministic: no network, provider, or DNS call, so "ready" means "correctly configured", never "verified working" -- a request that passes can still legitimately hit a 503 later (see llmService.js's PROVIDER_* codes). The credential is read only to test presence, never logged, returned, or format-validated.
"use strict";

const config = require("./config");

// Providers this codebase actually implements an adapter for -- kept in sync with llmService.js's askLlm() dispatch (which throws PROVIDER_NOT_IMPLEMENTED for anything else), so this module can never advertise readiness for a provider ask.js can't actually serve.
const IMPLEMENTED_PROVIDERS = Object.freeze(["openai", "gemini", "groq"]);

// Which environment variable holds the credential for each implemented
// provider -- kept in sync with llmService.js's own per-adapter
// process.env reads (askOpenAi reads OPENAI_API_KEY, askGemini reads
// GEMINI_API_KEY, askGroq reads GROQ_API_KEY). A provider present in
// IMPLEMENTED_PROVIDERS but absent from this map would be
// readiness-checked with no credential requirement at all, so every entry
// in IMPLEMENTED_PROVIDERS above must have a matching entry here. Each
// provider's credential is looked up ONLY by its own key -- there is no
// fallback to another provider's env var if the selected one is absent.
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

/**
 * Evaluates local SIA configuration readiness.
 *
 * Deterministic and side-effect free: no network, no database, no
 * provider call, no logging, no mutation of process.env or config.
 *
 * @returns {boolean} true only when every locally verifiable requirement
 *   below is satisfied:
 *     1. SIA is enabled            (config.enabled === true, from SIA_ENABLED)
 *     2. A provider is configured AND this codebase implements an adapter
 *        for it                    (SIA_LLM_PROVIDER, currently "openai",
 *                                    "gemini", or "groq")
 *     3. A non-blank model is configured   (SIA_LLM_MODEL)
 *     4. A non-blank API credential exists for the configured provider
 *        (OPENAI_API_KEY for "openai", GEMINI_API_KEY for "gemini",
 *        GROQ_API_KEY for "groq" -- read for presence only, never exposed)
 */
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
// Voice input (Workstream 2) -- a SEPARATE readiness check for SIA's
// speech-to-text capability, deliberately independent of isSiaReady()
// above: voice can be unavailable while text Q&A keeps working (and vice
// versa), so neither check reads the other's config fields, and neither
// call can affect the other's result. Same shape and same
// synchronous/side-effect-free/no-network contract as isSiaReady().
// ---------------------------------------------------------------------

// Providers this codebase implements an STT adapter for -- kept in sync
// with transcriptionService.js's transcribeAudio() dispatch (which throws
// PROVIDER_NOT_IMPLEMENTED for anything else), the same relationship
// IMPLEMENTED_PROVIDERS has with llmService.js above.
const IMPLEMENTED_STT_PROVIDERS = Object.freeze(["groq"]);

// Which environment variable holds the credential for each implemented STT
// provider -- kept in sync with transcriptionService.js's own per-adapter
// process.env read (the Groq STT adapter reads GROQ_API_KEY, the SAME
// variable the Groq TEXT adapter in llmService.js already reads; this is
// deliberate -- both are the same Groq account/credential -- but the two
// readiness checks below still evaluate this independently, never sharing
// a boolean result, so a text-only or voice-only deployment reports
// correctly either way). A provider present in IMPLEMENTED_STT_PROVIDERS
// but absent from this map would be readiness-checked with no credential
// requirement at all, so every entry above must have a matching entry
// here.
const STT_CREDENTIAL_ENV_VAR_BY_PROVIDER = Object.freeze({
  groq: "GROQ_API_KEY",
});

function normalizedSttProvider() {
  const provider = config.sttProvider;
  return typeof provider === "string" ? provider.trim() : provider;
}

/**
 * Evaluates local SIA voice-input (speech-to-text) configuration
 * readiness. Deterministic and side-effect free, identical contract to
 * isSiaReady(): no network, no database, no provider call, no logging, no
 * mutation of process.env or config.
 *
 * @returns {boolean} true only when every locally verifiable requirement
 *   below is satisfied:
 *     1. Voice input is enabled  (config.voiceEnabled === true, from SIA_VOICE_ENABLED)
 *     2. An STT provider is configured AND this codebase implements an
 *        adapter for it            (SIA_STT_PROVIDER, currently only "groq";
 *                                    config.js already defaults this to "groq")
 *     3. A non-blank API credential exists for the configured STT provider
 *        (GROQ_API_KEY for "groq" -- read for presence only, never exposed)
 */
function isVoiceReady() {
  // 1. Feature flag -- independent of SIA_ENABLED/config.enabled.
  if (config.voiceEnabled !== true) return false;

  // 2. Provider must be configured and implemented here.
  const provider = normalizedSttProvider();
  if (isBlank(provider)) return false;
  if (!IMPLEMENTED_STT_PROVIDERS.includes(provider)) return false;

  // 3. Credential presence only, read directly from process.env, never the
  // shared config object -- same rationale as isSiaReady()'s credential
  // check above.
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
