// SIA runtime-readiness evaluation -- the single authoritative "can SIA answer a new question right now?" check, called by both GET /sia/status and POST /sia/ask so neither can diverge. Purely local/synchronous/deterministic: no network, provider, or DNS call, so "ready" means "correctly configured", never "verified working" -- a request that passes can still legitimately hit a 503 later (see llmService.js's PROVIDER_* codes). The credential is read only to test presence, never logged, returned, or format-validated.
"use strict";

const config = require("./config");

// Providers this codebase actually implements an adapter for -- kept in sync with llmService.js's askLlm() dispatch (which throws PROVIDER_NOT_IMPLEMENTED for anything else), so this module can never advertise readiness for a provider ask.js can't actually serve.
const IMPLEMENTED_PROVIDERS = Object.freeze(["openai"]);

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
 *        for it                    (SIA_LLM_PROVIDER, currently "openai" only)
 *     3. A non-blank model is configured   (SIA_LLM_MODEL)
 *     4. A non-blank API credential exists (OPENAI_API_KEY, for the
 *        OpenAI adapter -- read for presence only, never exposed)
 */
function isSiaReady() {
  // 1. Feature flag -- config.js already fails closed for anything other than the exact string "true".
  if (config.enabled !== true) return false;

  // 2. Provider must be configured and implemented here, same as llmService.js treats it.
  const provider = normalizedProvider();
  if (isBlank(provider)) return false;
  if (!IMPLEMENTED_PROVIDERS.includes(provider)) return false;

  // 3. Model -- llmService.js's askOpenAi() throws MODEL_NOT_CONFIGURED for a blank model, and config.js supplies no default.
  if (isBlank(config.model)) return false;

  // 4. Credential presence only, read directly from process.env (never the shared config object) to keep the secret off the widely-imported config surface.
  if (provider === "openai" && isBlank(process.env.OPENAI_API_KEY)) return false;

  return true;
}

module.exports = {
  isSiaReady,
  IMPLEMENTED_PROVIDERS,
};
