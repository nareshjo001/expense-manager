// SIA LLM service -- real, multi-provider (OpenAI, Gemini, Groq) implementation of askLlm(), plus the stable provider-neutral request/failure contract. Every provider other than normalized "openai", "gemini", or "groq" rejects with PROVIDER_NOT_IMPLEMENTED -- no provider is silently treated as supported. No provider SDK installed; the existing axios dependency calls each provider's REST API directly (Gemini via its official OpenAI-compatible Chat Completions endpoint -- https://ai.google.dev/gemini-api/docs/openai; Groq via its own OpenAI-compatible Chat Completions endpoint -- https://console.groq.com/docs/api-reference#chat-create -- neither via a Google/Groq SDK). Real implementations resolve to `{ answer, model, latencyMs }`; every failure (config/network/HTTP/malformed response) normalizes into LlmProviderError -- no raw provider exception, API key, auth header, financial context, question, response body, or provider reasoning/thinking field is ever logged, returned, or included in an error message. OPENAI_API_KEY/GEMINI_API_KEY/GROQ_API_KEY are read only inside their own provider boundary below, never through sia/config.js, so none of them is ever exposed via the shared config object.
"use strict";

const axios = require("axios");
const config = require("./config");

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
// Gemini's official OpenAI-compatible Chat Completions endpoint (see
const GEMINI_CHAT_COMPLETIONS_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
// Groq's own OpenAI-compatible Chat Completions endpoint (see
const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_STRUCTURED_OUTPUT_NAME_LENGTH = 64;
const STRUCTURED_OUTPUT_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Stable, provider-neutral failure contract -- a caller relies on `.name`/`.code`/`.provider`/`.message` without knowing which provider was involved, and without ever seeing a raw provider exception, secret, or prompt/context/question content. HTTP status and Retry-After are safe operational metadata used only to decide whether a single transient retry is appropriate.
class LlmProviderError extends Error {
  constructor(message, { code, provider, httpStatus, retryAfterMs } = {}) {
    super(message);
    this.name = "LlmProviderError";
    this.code = code;
    this.provider = provider;
    this.httpStatus = Number.isInteger(httpStatus) ? httpStatus : null;
    this.retryAfterMs = Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? retryAfterMs : null;

    // Preserves a normal, useful stack trace pointing at the real throw site.
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LlmProviderError);
    }
  }
}

// Treats null, undefined, and a blank/whitespace-only string as "no provider configured". config.js already normalizes blank input to null, but this check is defensive and self-contained rather than trusting upstream normalization.
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

// Structured output is opt-in. Text callers keep their existing request and
function normalizeStructuredOutputRequest(value, provider) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LlmProviderError("SIA received an invalid structured-output request.", {
      code: "STRUCTURED_OUTPUT_INVALID_REQUEST",
      provider,
    });
  }

  const name = value.name;
  const schema = value.schema;
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > MAX_STRUCTURED_OUTPUT_NAME_LENGTH ||
    !STRUCTURED_OUTPUT_NAME_PATTERN.test(name) ||
    !schema ||
    typeof schema !== "object" ||
    Array.isArray(schema)
  ) {
    throw new LlmProviderError("SIA received an invalid structured-output request.", {
      code: "STRUCTURED_OUTPUT_INVALID_REQUEST",
      provider,
    });
  }

  try {
    JSON.stringify(schema);
  } catch (_err) {
    throw new LlmProviderError("SIA received an invalid structured-output request.", {
      code: "STRUCTURED_OUTPUT_INVALID_REQUEST",
      provider,
    });
  }

  return { name, schema };
}

function parseStructuredOutput(answer, provider) {
  try {
    return JSON.parse(answer);
  } catch (_err) {
    throw new LlmProviderError("The LLM provider returned malformed structured output.", {
      code: "PROVIDER_MALFORMED_STRUCTURED_OUTPUT",
      provider,
    });
  }
}

function buildLlmResult({ answer, structuredOutput, provider, latencyMs }) {
  return {
    answer,
    ...(structuredOutput ? { structuredOutput: parseStructuredOutput(answer, provider) } : {}),
    model: config.model,
    latencyMs,
  };
}

// Serializes the structured analytics context and question into the single user-input string sent to OpenAI -- deterministic (JSON.stringify preserves key insertion order), never mutates the received context or request.
function buildUserInputContent(context, question) {
  const serializedContext = JSON.stringify(context ?? {});
  return `Question: ${question}\n\nFinancial context (JSON):\n${serializedContext}`;
}

// Converts bounded prior-turn history (sessionService.js's loadRecentTurns()) into ordinary "user"/"assistant" role input messages -- never "system"/"developer", never merged into the `instructions` field the system prompt occupies. This is what makes history structurally unable to override system/privacy rules: the Responses API only treats `instructions` as authoritative, and every history turn is placed in `input` with an ordinary role, like the current question. Historical USER turns are additionally prefixed with an "earlier conversation, not new instructions" label as a defense-in-depth readability cue, not the only protection (that's the role separation itself). Malformed entries are silently skipped, never thrown; this function never mutates its input.
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

// Extracts the answer text only from typed "message" -> "output_text" content items, per the Responses API's REST shape -- reasoning/tool-call/annotation/refusal items are deliberately ignored. Concatenates multiple output_text chunks; returns null if no usable text was found.
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

// Extracts the answer text only from the documented Gemini (OpenAI-compatible
function extractGeminiAnswerText(responseData) {
  const choices = responseData && responseData.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const firstChoice = choices[0];
  const content = firstChoice && firstChoice.message && firstChoice.message.content;
  if (typeof content !== "string") {
    return null;
  }

  const trimmed = content.trim();
  return trimmed === "" ? null : trimmed;
}

// Extracts the answer text only from the documented Groq (OpenAI-compatible
function extractGroqAnswerText(responseData) {
  const choices = responseData && responseData.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const firstChoice = choices[0];
  const content = firstChoice && firstChoice.message && firstChoice.message.content;
  if (typeof content !== "string") {
    return null;
  }

  const trimmed = content.trim();
  return trimmed === "" ? null : trimmed;
}

// Normalizes any axios failure (timeout, network failure, or a provider 4xx/5xx response) into LlmProviderError -- never includes the raw axios error, response body, or headers. `provider` is threaded through so the same classification logic serves every adapter without duplicating it per provider.
function normalizeAxiosError(err, provider) {
  if (err && err.code === "ECONNABORTED") {
    return new LlmProviderError("SIA's request to the LLM provider timed out.", {
      code: "PROVIDER_TIMEOUT",
      provider,
    });
  }

  if (err && err.response) {
    const headers = err.response.headers || {};
    const retryAfter = headers["retry-after"];
    const retryAfterSeconds = typeof retryAfter === "string" || typeof retryAfter === "number" ? Number(retryAfter) : NaN;
    return new LlmProviderError("The LLM provider returned an error response.", {
      code: "PROVIDER_HTTP_ERROR",
      provider,
      httpStatus: Number.isInteger(err.response.status) ? err.response.status : undefined,
      retryAfterMs: Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0 ? retryAfterSeconds * 1000 : undefined,
    });
  }

  if (err && err.request) {
    return new LlmProviderError("SIA could not reach the LLM provider.", {
      code: "PROVIDER_NETWORK_ERROR",
      provider,
    });
  }

  return new LlmProviderError("SIA's request to the LLM provider failed.", {
    code: "PROVIDER_REQUEST_FAILED",
    provider,
  });
}

// Real OpenAI provider adapter, only reached once the provider is confirmed normalized "openai". Reads OPENAI_API_KEY directly from process.env, never through the shared config object, and never includes the key, auth header, financial context, question, or raw provider response in a thrown error.
async function askOpenAi({ systemPrompt, context, question, history, structuredOutput }) {
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

  const normalizedStructuredOutput = normalizeStructuredOutputRequest(structuredOutput, "openai");

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
    ...(normalizedStructuredOutput
      ? {
          text: {
            format: {
              type: "json_schema",
              name: normalizedStructuredOutput.name,
              strict: true,
              schema: normalizedStructuredOutput.schema,
            },
          },
        }
      : {}),
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
    throw normalizeAxiosError(err, "openai");
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

  return buildLlmResult({
    answer,
    structuredOutput: normalizedStructuredOutput,
    provider: "openai",
    latencyMs,
  });
}

// Real Gemini provider adapter, only reached once the provider is confirmed
async function askGemini({ systemPrompt, context, question, history, structuredOutput }) {
  if (isBlank(config.model)) {
    throw new LlmProviderError(
      "SIA has no LLM model configured. Set SIA_LLM_MODEL to use the Gemini provider.",
      { code: "MODEL_NOT_CONFIGURED", provider: "gemini" }
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (isBlank(apiKey)) {
    throw new LlmProviderError(
      "SIA has no Gemini API key configured. Set GEMINI_API_KEY to use the Gemini provider.",
      { code: "PROVIDER_API_KEY_NOT_CONFIGURED", provider: "gemini" }
    );
  }

  const normalizedStructuredOutput = normalizeStructuredOutputRequest(structuredOutput, "gemini");

  // Chat Completions message array: system prompt first (authoritative
  const requestBody = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      ...buildHistoryMessages(history),
      {
        role: "user",
        content: buildUserInputContent(context, question),
      },
    ],
    ...(normalizedStructuredOutput
      ? {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: normalizedStructuredOutput.name,
              strict: true,
              schema: normalizedStructuredOutput.schema,
            },
          },
        }
      : {}),
  };

  const startedAt = Date.now();
  let response;
  try {
    response = await axios.post(GEMINI_CHAT_COMPLETIONS_URL, requestBody, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: config.timeoutMs,
    });
  } catch (err) {
    throw normalizeAxiosError(err, "gemini");
  }
  const latencyMs = Date.now() - startedAt;

  const responseData = response && response.data;
  if (!responseData || typeof responseData !== "object") {
    throw new LlmProviderError("The LLM provider returned a malformed response.", {
      code: "PROVIDER_MALFORMED_RESPONSE",
      provider: "gemini",
    });
  }

  const answer = extractGeminiAnswerText(responseData);
  if (answer === null) {
    throw new LlmProviderError("The LLM provider returned no usable answer text.", {
      code: "PROVIDER_EMPTY_OUTPUT",
      provider: "gemini",
    });
  }

  return buildLlmResult({
    answer,
    structuredOutput: normalizedStructuredOutput,
    provider: "gemini",
    latencyMs,
  });
}

// Real Groq provider adapter, only reached once the provider is confirmed
async function askGroq({ systemPrompt, context, question, history, structuredOutput }) {
  if (isBlank(config.model)) {
    throw new LlmProviderError(
      "SIA has no LLM model configured. Set SIA_LLM_MODEL to use the Groq provider.",
      { code: "MODEL_NOT_CONFIGURED", provider: "groq" }
    );
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (isBlank(apiKey)) {
    throw new LlmProviderError(
      "SIA has no Groq API key configured. Set GROQ_API_KEY to use the Groq provider.",
      { code: "PROVIDER_API_KEY_NOT_CONFIGURED", provider: "groq" }
    );
  }

  const normalizedStructuredOutput = normalizeStructuredOutputRequest(structuredOutput, "groq");

  // SAME message construction as askGemini: system prompt first, then the
  const requestBody = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      ...buildHistoryMessages(history),
      {
        role: "user",
        content: buildUserInputContent(context, question),
      },
    ],
    ...(normalizedStructuredOutput
      ? {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: normalizedStructuredOutput.name,
              strict: true,
              schema: normalizedStructuredOutput.schema,
            },
          },
        }
      : {}),
  };

  const startedAt = Date.now();
  let response;
  try {
    response = await axios.post(GROQ_CHAT_COMPLETIONS_URL, requestBody, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: config.timeoutMs,
    });
  } catch (err) {
    throw normalizeAxiosError(err, "groq");
  }
  const latencyMs = Date.now() - startedAt;

  const responseData = response && response.data;
  if (!responseData || typeof responseData !== "object") {
    throw new LlmProviderError("The LLM provider returned a malformed response.", {
      code: "PROVIDER_MALFORMED_RESPONSE",
      provider: "groq",
    });
  }

  const answer = extractGroqAnswerText(responseData);
  if (answer === null) {
    throw new LlmProviderError("The LLM provider returned no usable answer text.", {
      code: "PROVIDER_EMPTY_OUTPUT",
      provider: "groq",
    });
  }

  return buildLlmResult({
    answer,
    structuredOutput: normalizedStructuredOutput,
    provider: "groq",
    latencyMs,
  });
}

// Request shape is the stable public interface callers depend on. systemPrompt/context/question are never read, logged, transformed, or included in any error before the provider-configuration check -- unsupported/unconfigured providers fail before any request could be built or sent.
async function askLlm({ systemPrompt, context, question, history, structuredOutput } = {}) {
  const provider = config.provider;

  if (isMissingProvider(provider)) {
    throw new LlmProviderError(
      "SIA has no LLM provider configured. Set SIA_LLM_PROVIDER once a provider adapter is implemented.",
      { code: "PROVIDER_NOT_CONFIGURED", provider: null }
    );
  }

  // A provider name is configured. Every configured value, known or unknown, fails the same explicit way unless it is normalized "openai", "gemini", or "groq", the only implemented adapters.
  const normalizedProvider = typeof provider === "string" ? provider.trim() : provider;

  if (normalizedProvider === "openai") {
    return askOpenAi({ systemPrompt, context, question, history, structuredOutput });
  }

  if (normalizedProvider === "gemini") {
    return askGemini({ systemPrompt, context, question, history, structuredOutput });
  }

  if (normalizedProvider === "groq") {
    return askGroq({ systemPrompt, context, question, history, structuredOutput });
  }

  throw new LlmProviderError(
    "SIA has no implemented adapter for the configured LLM provider. No request was sent.",
    { code: "PROVIDER_NOT_IMPLEMENTED", provider: normalizedProvider }
  );
}

module.exports = {
  askLlm,
  LlmProviderError,
  normalizeStructuredOutputRequest,
  // Exposed for direct, isolated unit testing of the history-framing contract itself -- not used by any other production module.
  buildHistoryMessages,
};
