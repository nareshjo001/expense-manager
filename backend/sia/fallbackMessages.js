// SIA-001-T05 -- deterministic (never LLM-generated) fallback responses
// for SIA's ask/answer path. Replaces a single flat "SIA is temporarily
// unavailable." for every failure with a small, fixed, pre-written set of
// safe categories selected purely by RULE (a stable LlmProviderError code
// or an explicit internal reasonCode) -- never by provider name, raw
// error message, stack trace, or any other internal detail.
//
// Deliberately preserves the SAME "never disclose why" posture
// GET /sia/status already established for deployment-level readiness (see
// SIA-001-T01's provider-disclosure audit: "available: false is
// intentionally indistinguishable between all of its causes... never
// returns the provider name, model name, credential presence or value,
// missing environment-variable names, an internal reason code,
// configuration details, or a stack trace"). Every STRUCTURAL/
// configuration failure (no provider configured, an unimplemented
// provider, no model configured, no API key configured, an invalid
// structured-output request, a malformed structured-output response, a
// snapshot-build failure, a session-store/idempotency infrastructure
// error, or any unrecognized error) still collapses into the exact same
// generic UNAVAILABLE category as before this task -- this module only
// ADDS narrower categories for outcomes that are safe to distinguish
// precisely because they reveal nothing about deployment configuration:
// a transient provider hiccup (worth retrying shortly), the LLM's own
// answer failing this app's grounding/leakage validation (worth
// rephrasing), a too-large question (worth narrowing), and (SIA-001-T06)
// the user's own opt-out choice (worth pointing at Settings, since it's
// their own account state, not a system secret).
"use strict";

const CATEGORY = Object.freeze({
  UNAVAILABLE: "UNAVAILABLE",
  RETRY_SHORTLY: "RETRY_SHORTLY",
  ANSWER_UNAVAILABLE: "ANSWER_UNAVAILABLE",
  QUESTION_TOO_COMPLEX: "QUESTION_TOO_COMPLEX",
  SIA_DISABLED_BY_USER: "SIA_DISABLED_BY_USER",
});

const RESPONSES = Object.freeze({
  [CATEGORY.UNAVAILABLE]: {
    status: 503,
    body: { success: false, code: CATEGORY.UNAVAILABLE, message: "SIA is temporarily unavailable." },
  },
  [CATEGORY.RETRY_SHORTLY]: {
    status: 503,
    body: {
      success: false,
      code: CATEGORY.RETRY_SHORTLY,
      message: "SIA couldn't reach its AI provider just now. Please try again in a moment.",
    },
  },
  [CATEGORY.ANSWER_UNAVAILABLE]: {
    status: 503,
    body: {
      success: false,
      code: CATEGORY.ANSWER_UNAVAILABLE,
      message:
        "SIA couldn't produce a reliable answer to that question. Try rephrasing it, or ask about a specific time period or category.",
    },
  },
  [CATEGORY.QUESTION_TOO_COMPLEX]: {
    status: 422,
    body: {
      success: false,
      code: CATEGORY.QUESTION_TOO_COMPLEX,
      message:
        "That's a lot for SIA to consider at once. Try asking a narrower question -- about one category, time period, or budget at a time.",
    },
  },
  [CATEGORY.SIA_DISABLED_BY_USER]: {
    status: 403,
    body: {
      success: false,
      code: CATEGORY.SIA_DISABLED_BY_USER,
      message: "You've turned off SIA's AI features. You can turn them back on from Settings.",
    },
  },
});

// Provider-health-signal codes (see providerCircuitBreaker.js's own
// identical list) -- a real attempt was made and the PROVIDER itself
// misbehaved, so retrying shortly is genuinely reasonable advice.
// PROVIDER_CIRCUIT_OPEN is included too: from the user's point of view
// it is the exact same "try again shortly" situation, whether this
// specific request tripped the breaker or a previous one already did.
const RETRY_SHORTLY_CODES = new Set([
  "PROVIDER_TIMEOUT",
  "PROVIDER_HTTP_ERROR",
  "PROVIDER_NETWORK_ERROR",
  "PROVIDER_MALFORMED_RESPONSE",
  "PROVIDER_EMPTY_OUTPUT",
  "PROVIDER_RESPONSE_INCOMPLETE",
  "PROVIDER_CIRCUIT_OPEN",
]);

// Classifies a thrown error (an LlmProviderError, or any other error --
// never assumes the shape) into one of the safe categories above. Any
// code this module doesn't explicitly recognize -- including every
// structural/configuration LlmProviderError code, and a non-LlmProviderError
// entirely -- falls back to UNAVAILABLE, so a NEW LlmProviderError code
// added to llmService.js in the future is safe-by-default here too: it
// must be explicitly added to RETRY_SHORTLY_CODES (or given its own
// category) to become anything more specific than the generic message.
function classifyProviderError(error) {
  const code = error && error.code;
  if (code === "CONTEXT_BUDGET_EXCEEDED") return CATEGORY.QUESTION_TOO_COMPLEX;
  if (RETRY_SHORTLY_CODES.has(code)) return CATEGORY.RETRY_SHORTLY;
  return CATEGORY.UNAVAILABLE;
}

function responseFor(category) {
  return RESPONSES[category] || RESPONSES[CATEGORY.UNAVAILABLE];
}

module.exports = {
  CATEGORY,
  classifyProviderError,
  responseFor,
};
