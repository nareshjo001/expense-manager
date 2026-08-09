// SIA runtime-readiness evaluation -- Batch 3E.
//
// THE single authoritative answer to "can SIA answer a new question right
// now?". Both GET /sia/status (Controllers/SiaControllers/status.js) and
// POST /sia/ask (Controllers/SiaControllers/ask.js) call isSiaReady()
// below -- the rules are deliberately implemented exactly once, so the
// status endpoint can never advertise an availability the ask endpoint
// would then refuse (or vice versa).
//
// WHAT THIS PROVES, PRECISELY: every locally verifiable configuration
// requirement the currently-implemented provider adapter actually enforces
// is satisfied. Each condition below mirrors a real, existing failure
// branch in sia/llmService.js -- this module adds no new requirement of
// its own, it only evaluates the same conditions EARLIER (before a request
// is admitted) instead of after a provider call has already been attempted.
//
// WHAT THIS DELIBERATELY DOES NOT PROVE (the honest boundary): that OpenAI
// is currently reachable, that the credential is accepted by OpenAI, that
// the configured model exists or is entitled to this account, or that the
// account has remaining quota. NO network request, provider call, DNS
// lookup, or external probe happens here -- readiness is a purely local,
// synchronous, deterministic configuration check. A ready result therefore
// means "correctly configured", never "verified working". A request that
// passes this gate can still legitimately fail later with the existing
// generic 503 (see llmService.js's PROVIDER_* error codes), and that
// remains the correct behaviour for a genuine provider/network failure.
//
// The credential itself is read ONLY to test whether a non-blank value
// exists. It is never returned, logged, serialized, included in an error,
// length-reported, or exposed in any form -- and it is deliberately NOT
// validated against a prefix, character set, or assumed length, since
// provider key formats change and a format guess would reject a valid key.
"use strict";

const config = require("./config");

// The providers this codebase actually implements an adapter for. Kept in
// sync with sia/llmService.js's askLlm() dispatch, which throws
// PROVIDER_NOT_IMPLEMENTED for every other value -- a provider named here
// that llmService cannot dispatch would be exactly the "status says ready,
// ask says 503" divergence this module exists to prevent. Batch 3E adds no
// new provider.
const IMPLEMENTED_PROVIDERS = Object.freeze(["openai"]);

// Mirrors llmService.js's own isBlank(): null, undefined, a non-string, and
// a whitespace-only string all count as "not configured".
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
  // 1. Feature flag. config.js already fails closed for any value other
  //    than the exact string "true".
  if (config.enabled !== true) return false;

  // 2. Provider must be configured AND implemented here. An unimplemented
  //    provider name is treated exactly as llmService.js treats it -- not
  //    usable -- rather than being optimistically reported as ready.
  const provider = normalizedProvider();
  if (isBlank(provider)) return false;
  if (!IMPLEMENTED_PROVIDERS.includes(provider)) return false;

  // 3. Model. llmService.js's askOpenAi() throws MODEL_NOT_CONFIGURED for
  //    a blank model, and config.js deliberately supplies no default, so a
  //    missing model genuinely means SIA cannot answer.
  if (isBlank(config.model)) return false;

  // 4. Credential, per the configured provider's own requirement. Read
  //    directly from process.env (never through the shared config object)
  //    for exactly the same reason llmService.js does: keeping the secret
  //    off the shared, widely-imported config surface. Presence only --
  //    the value is never captured, compared, measured, or returned.
  if (provider === "openai" && isBlank(process.env.OPENAI_API_KEY)) return false;

  return true;
}

module.exports = {
  isSiaReady,
  IMPLEMENTED_PROVIDERS,
};
