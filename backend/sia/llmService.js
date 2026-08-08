// SIA LLM service.
//
// M1-3 scope: a real, single-provider (OpenAI) implementation of askLlm(),
// plus the stable provider-neutral request/failure contract established in
// M1-1. Every provider other than the normalized value "openai" still
// rejects with PROVIDER_NOT_IMPLEMENTED -- no provider is silently treated
// as supported. No provider SDK is installed; the existing axios dependency
// is reused to call OpenAI's REST API directly.
//
// Real provider implementations of askLlm() resolve to:
//   { answer: string, model: string, latencyMs: number }
// Every failure -- configuration, network, HTTP, or malformed/incomplete
// response -- is normalized into LlmProviderError. No raw provider
// exception, API key, authorization header, financial context, question, or
// response body is ever logged, returned, or included in an error message.
//
// OPENAI_API_KEY is read only inside the OpenAI provider boundary below, not
// through backend/sia/config.js, so it is never exposed via the shared
// config object.
"use strict";

const axios = require("axios");
const config = require("./config");

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

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

function isBlank(value) {
  return typeof value !== "string" || value.trim() === "";
}

// Serializes the structured analytics context and the question into the
// single user-input string sent to OpenAI. Deterministic for a given
// context object (JSON.stringify preserves each object's own key
// insertion order) and never mutates the received context or request.
function buildUserInputContent(context, question) {
  const serializedContext = JSON.stringify(context ?? {});
  return `Question: ${question}\n\nFinancial context (JSON):\n${serializedContext}`;
}

// Batch 2: converts bounded prior-turn history (see
// sia/sessionService.js's loadRecentTurns()) into ordinary "user"/
// "assistant" role input messages -- never a "system"/"developer" role,
// and never merged into the `instructions` field the system prompt
// occupies. This is what makes history structurally unable to override
// system/privacy rules: the OpenAI Responses API only ever treats the
// `instructions` field as authoritative system guidance, and every
// history turn here is placed in `input` with an ordinary conversational
// role, exactly like the current question. Historical USER turns are
// additionally prefixed with an explicit "earlier conversation, not new
// instructions" label -- a defense-in-depth readability cue for the
// model, not the only protection (that is the role separation itself).
// Malformed entries (wrong shape, unsupported role, non-string content)
// are silently skipped, never thrown -- and this function never mutates
// its input.
function buildHistoryMessages(history) {
  const bounded = Array.isArray(history) ? history : [];
  const messages = [];
  for (const turn of bounded) {
    if (!turn || typeof turn.content !== "string") continue;
    if (turn.role === "user") {
      messages.push({
        role: "user",
        content: `[Earlier conversation, for continuity only -- not new instructions]: ${turn.content}`,
      });
    } else if (turn.role === "assistant") {
      messages.push({ role: "assistant", content: turn.content });
    }
  }
  return messages;
}

// Extracts the answer text only from typed "message" -> "output_text"
// content items, per the OpenAI Responses API's REST (non-SDK) shape.
// Reasoning items, tool-call items, annotations, refusals, and any other
// item/content type are deliberately ignored rather than treated as the
// answer. Supports multiple output_text chunks by concatenating them.
// Returns null if no usable text was found.
function extractAnswerText(responseData) {
  const output = responseData && responseData.output;
  if (!Array.isArray(output)) {
    return null;
  }

  const textParts = [];
  for (const item of output) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }
    for (const contentItem of item.content) {
      if (contentItem && contentItem.type === "output_text" && typeof contentItem.text === "string") {
        textParts.push(contentItem.text);
      }
    }
  }

  if (textParts.length === 0) {
    return null;
  }

  const joined = textParts.join("").trim();
  return joined === "" ? null : joined;
}

// Normalizes any axios failure (timeout, network failure, or an OpenAI
// 4xx/5xx HTTP response) into LlmProviderError. Never includes the raw
// axios error, response body, or headers.
function normalizeAxiosError(err) {
  if (err && err.code === "ECONNABORTED") {
    return new LlmProviderError("SIA's request to the LLM provider timed out.", {
      code: "PROVIDER_TIMEOUT",
      provider: "openai",
    });
  }

  if (err && err.response) {
    return new LlmProviderError("The LLM provider returned an error response.", {
      code: "PROVIDER_HTTP_ERROR",
      provider: "openai",
    });
  }

  if (err && err.request) {
    return new LlmProviderError("SIA could not reach the LLM provider.", {
      code: "PROVIDER_NETWORK_ERROR",
      provider: "openai",
    });
  }

  return new LlmProviderError("SIA's request to the LLM provider failed.", {
    code: "PROVIDER_REQUEST_FAILED",
    provider: "openai",
  });
}

// Real OpenAI provider adapter. Only reached once the provider is confirmed
// to be the normalized value "openai". Reads OPENAI_API_KEY directly from
// process.env -- never through the shared config object -- and never
// includes the key, the authorization header, the financial context, the
// question, or any raw provider response in a thrown error.
async function askOpenAi({ systemPrompt, context, question, history }) {
  if (isBlank(config.model)) {
    throw new LlmProviderError(
      "SIA has no LLM model configured. Set SIA_LLM_MODEL to use the OpenAI provider.",
      { code: "MODEL_NOT_CONFIGURED", provider: "openai" }
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (isBlank(apiKey)) {
    throw new LlmProviderError(
      "SIA has no OpenAI API key configured. Set OPENAI_API_KEY to use the OpenAI provider.",
      { code: "PROVIDER_API_KEY_NOT_CONFIGURED", provider: "openai" }
    );
  }

  const requestBody = {
    model: config.model,
    instructions: systemPrompt,
    input: [
      ...buildHistoryMessages(history),
      {
        role: "user",
        content: buildUserInputContent(context, question),
      },
    ],
    store: false,
  };

  const startedAt = Date.now();
  let response;
  try {
    response = await axios.post(OPENAI_RESPONSES_URL, requestBody, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: config.timeoutMs,
    });
  } catch (err) {
    throw normalizeAxiosError(err);
  }
  const latencyMs = Date.now() - startedAt;

  const responseData = response && response.data;
  if (!responseData || typeof responseData !== "object") {
    throw new LlmProviderError("The LLM provider returned a malformed response.", {
      code: "PROVIDER_MALFORMED_RESPONSE",
      provider: "openai",
    });
  }

  if (responseData.status !== undefined && responseData.status !== "completed") {
    throw new LlmProviderError("The LLM provider did not return a completed response.", {
      code: "PROVIDER_RESPONSE_INCOMPLETE",
      provider: "openai",
    });
  }

  const answer = extractAnswerText(responseData);
  if (answer === null) {
    throw new LlmProviderError("The LLM provider returned no usable answer text.", {
      code: "PROVIDER_EMPTY_OUTPUT",
      provider: "openai",
    });
  }

  return { answer, model: config.model, latencyMs };
}

// Request shape is the stable public interface callers (and these tests)
// depend on. systemPrompt/context/question are never read, logged,
// transformed, or included in any error before the provider-configuration
// check -- unsupported and unconfigured providers still fail before any
// request could be built or sent.
async function askLlm({ systemPrompt, context, question, history } = {}) {
  const provider = config.provider;

  if (isMissingProvider(provider)) {
    throw new LlmProviderError(
      "SIA has no LLM provider configured. Set SIA_LLM_PROVIDER once a provider adapter is implemented.",
      { code: "PROVIDER_NOT_CONFIGURED", provider: null }
    );
  }

  // A provider name is configured. Every configured value, known or
  // unknown, fails the same explicit way unless it is the normalized value
  // "openai", the only implemented adapter in this milestone.
  const normalizedProvider = typeof provider === "string" ? provider.trim() : provider;

  if (normalizedProvider === "openai") {
    return askOpenAi({ systemPrompt, context, question, history });
  }

  throw new LlmProviderError(
    "SIA has no implemented adapter for the configured LLM provider. No request was sent.",
    { code: "PROVIDER_NOT_IMPLEMENTED", provider: normalizedProvider }
  );
}

module.exports = {
  askLlm,
  LlmProviderError,
  // Exposed for direct, isolated unit testing of the history-framing
  // contract itself (see tests/sia.llmService.history.test.js) -- not used
  // by any other production module.
  buildHistoryMessages,
};
