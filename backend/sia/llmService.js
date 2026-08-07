// SIA LLM service.
//
// M1-3 scope: a provider-neutral stub only. This establishes the stable
// askLlm() request contract, the future successful-response contract, and a
// typed, provider-neutral failure contract that later SIA modules and a
// future route layer can mock and build against -- before any real LLM
// provider (OpenAI, Gemini, Anthropic, or otherwise) is selected, installed,
// or integrated. No provider SDK, network client, or API-key variable is
// introduced in this file.
//
// Future, real provider implementations of askLlm() must resolve to:
//   { answer: string, model: string, latencyMs: number }
// This stub NEVER resolves to that shape, because no provider exists yet --
// askLlm() always rejects with LlmProviderError instead of returning a
// fabricated, placeholder, or fallback answer.
//
// Timeout enforcement is deliberately deferred: backend/sia/config.js
// already defines config.timeoutMs (M1-1), but there is no outbound
// provider operation in this stub to bound with a timeout. Adding a fake
// timer or artificial delay here would only simulate timeout support that
// doesn't exist. When a real provider adapter is implemented in a later
// milestone, its single outbound call must be bounded by config.timeoutMs,
// and any provider failure (including a timeout) must be normalized into
// LlmProviderError -- not surfaced as a raw provider exception.
"use strict";

const config = require("./config");

// Stable, provider-neutral failure contract. A caller can rely on `.name`,
// `.code`, `.provider`, and `.message` without needing to know which (if
// any) provider was involved, and without ever seeing a raw provider
// exception, a secret, or any prompt/context/question content. This layer
// deliberately does not invent an HTTP status code -- that mapping belongs
// to a future route, not to this service.
class LlmProviderError extends Error {
  constructor(message, { code, provider } = {}) {
    super(message);
    this.name = "LlmProviderError";
    this.code = code;
    this.provider = provider;

    // Preserves a normal, useful stack trace pointing at the real throw
    // site, the same as any other hand-thrown Error subclass.
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LlmProviderError);
    }
  }
}

// Treats null, undefined, and a blank/whitespace-only string as "no
// provider configured". backend/sia/config.js already normalizes blank
// input to null (see config.js's normalizeProvider), but this check is
// defensive and self-contained rather than trusting that normalization
// happened upstream.
function isMissingProvider(provider) {
  return (
    provider === null ||
    provider === undefined ||
    (typeof provider === "string" && provider.trim() === "")
  );
}

// Request shape is the stable public interface future callers (and this
// stub's own tests) depend on. systemPrompt/context/question are never read,
// logged, transformed, or included in any error, because this stub never
// reaches a point where a real request could be built or sent -- it always
// fails before that, on the provider-configuration check alone.
async function askLlm({ systemPrompt, context, question } = {}) {
  const provider = config.provider;

  if (isMissingProvider(provider)) {
    throw new LlmProviderError(
      "SIA has no LLM provider configured. Set SIA_LLM_PROVIDER once a provider adapter is implemented.",
      { code: "PROVIDER_NOT_CONFIGURED", provider: null }
    );
  }

  // A provider name is configured, but no provider adapter exists yet in
  // this milestone. No provider is silently treated as supported -- every
  // configured value, known or unknown, fails the same explicit way.
  const normalizedProvider = typeof provider === "string" ? provider.trim() : provider;

  throw new LlmProviderError(
    "SIA has no implemented adapter for the configured LLM provider. No request was sent.",
    { code: "PROVIDER_NOT_IMPLEMENTED", provider: normalizedProvider }
  );
}

module.exports = {
  askLlm,
  LlmProviderError,
};
