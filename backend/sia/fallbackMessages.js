// Deterministic (never LLM-generated) fallback responses for SIA's ask/answer path.
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

// Js's own identical list) -- a real attempt was made and the PROVIDER itself misbehaved, so retrying shortly is genuinely reasonable advice.
const RETRY_SHORTLY_CODES = new Set([
  "PROVIDER_TIMEOUT",
  "PROVIDER_HTTP_ERROR",
  "PROVIDER_NETWORK_ERROR",
  "PROVIDER_MALFORMED_RESPONSE",
  "PROVIDER_EMPTY_OUTPUT",
  "PROVIDER_RESPONSE_INCOMPLETE",
  "PROVIDER_CIRCUIT_OPEN",
]);

// Classifies a thrown error (an LlmProviderError, or any other error -- never assumes the shape) into one of the safe categories above.
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
