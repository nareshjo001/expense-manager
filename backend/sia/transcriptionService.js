// SIA transcription service (Workstream 2) -- provider-neutral speech-to-
"use strict";

const axios = require("axios");
const FormData = require("form-data");
const config = require("./config");

const GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

// Stable, provider-neutral failure contract -- a caller relies on
class TranscriptionProviderError extends Error {
  constructor(message, { code, provider } = {}) {
    super(message);
    this.name = "TranscriptionProviderError";
    this.code = code;
    this.provider = provider;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TranscriptionProviderError);
    }
  }
}

function isBlank(value) {
  return typeof value !== "string" || value.trim() === "";
}

// Treats null, undefined, and a blank/whitespace-only string as "no
function isMissingProvider(provider) {
  return provider === null || provider === undefined || (typeof provider === "string" && provider.trim() === "");
}

// Normalizes any axios failure (client-initiated abort, timeout, network
function normalizeAxiosError(err, provider) {
  // A client disconnect mid-request aborts the outbound axios call via
  if (err && (err.code === "ERR_CANCELED" || err.name === "AbortError" || err.name === "CanceledError")) {
    return new TranscriptionProviderError("SIA's request to the transcription provider was aborted.", {
      code: "PROVIDER_REQUEST_ABORTED",
      provider,
    });
  }

  if (err && err.code === "ECONNABORTED") {
    return new TranscriptionProviderError("SIA's request to the transcription provider timed out.", {
      code: "PROVIDER_TIMEOUT",
      provider,
    });
  }

  if (err && err.response) {
    return new TranscriptionProviderError("The transcription provider returned an error response.", {
      code: "PROVIDER_HTTP_ERROR",
      provider,
    });
  }

  if (err && err.request) {
    return new TranscriptionProviderError("SIA could not reach the transcription provider.", {
      code: "PROVIDER_NETWORK_ERROR",
      provider,
    });
  }

  return new TranscriptionProviderError("SIA's request to the transcription provider failed.", {
    code: "PROVIDER_REQUEST_FAILED",
    provider,
  });
}

// Extracts the transcript/language/duration only from the documented Groq
function extractGroqTranscription(responseData) {
  if (!responseData || typeof responseData !== "object") {
    return null;
  }

  const text = responseData.text;
  if (typeof text !== "string") {
    return null;
  }
  const trimmedText = text.trim();
  if (trimmedText === "") {
    return null;
  }

  const language =
    typeof responseData.language === "string" && responseData.language.trim() !== ""
      ? responseData.language.trim()
      : "unknown";

  const durationSeconds =
    typeof responseData.duration === "number" && Number.isFinite(responseData.duration) && responseData.duration >= 0
      ? responseData.duration
      : null;

  return {
    text: trimmedText,
    language,
    durationMs: durationSeconds === null ? null : Math.round(durationSeconds * 1000),
  };
}

// Real Groq STT provider adapter, only reached once the provider is
async function transcribeWithGroq({ buffer, filename, mimeType, languageHint, signal }) {
  if (isBlank(config.sttModel)) {
    throw new TranscriptionProviderError(
      "SIA has no STT model configured. Set SIA_STT_MODEL to use the Groq provider.",
      { code: "MODEL_NOT_CONFIGURED", provider: "groq" }
    );
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (isBlank(apiKey)) {
    throw new TranscriptionProviderError(
      "SIA has no Groq API key configured. Set GROQ_API_KEY to use the Groq STT provider.",
      { code: "PROVIDER_API_KEY_NOT_CONFIGURED", provider: "groq" }
    );
  }

  // Real multipart/form-data encoding (correct boundary, correct headers)
  // via the `form-data` package -- never a hand-built boundary string.
  const form = new FormData();
  form.append("file", buffer, {
    // Server-generated filename only -- the client-supplied original
    // filename is never read anywhere in this pipeline.
    filename: filename || "audio",
    contentType: mimeType || "application/octet-stream",
  });
  form.append("model", config.sttModel);
  form.append("temperature", "0");
  // verbose_json is the one response_format that carries both `language`
  form.append("response_format", "verbose_json");
  if (typeof languageHint === "string" && languageHint.trim() !== "") {
    form.append("language", languageHint.trim());
  }

  const startedAt = Date.now();
  let response;
  try {
    response = await axios.post(GROQ_TRANSCRIPTIONS_URL, form, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...form.getHeaders(),
      },
      timeout: config.sttTimeoutMs,
      signal,
      // Audio bodies (bounded by SIA_STT_MAX_BYTES upstream, but not yet
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
  } catch (err) {
    throw normalizeAxiosError(err, "groq");
  }
  const latencyMs = Date.now() - startedAt;

  const responseData = response && response.data;
  if (!responseData || typeof responseData !== "object") {
    throw new TranscriptionProviderError("The transcription provider returned a malformed response.", {
      code: "PROVIDER_MALFORMED_RESPONSE",
      provider: "groq",
    });
  }

  const extracted = extractGroqTranscription(responseData);
  if (extracted === null) {
    throw new TranscriptionProviderError("The transcription provider returned no usable transcript.", {
      code: "PROVIDER_EMPTY_OUTPUT",
      provider: "groq",
    });
  }

  return {
    transcript: extracted.text,
    detectedLanguage: extracted.language,
    // Falls back to observed request latency only in the (unexpected)
    // case the provider omitted `duration` -- never fabricated as 0.
    durationMs: extracted.durationMs === null ? latencyMs : extracted.durationMs,
  };
}

// Request shape is the stable public interface callers depend on.
async function transcribeAudio({ buffer, filename, mimeType, languageHint, signal } = {}) {
  const provider = config.sttProvider;

  if (isMissingProvider(provider)) {
    throw new TranscriptionProviderError(
      "SIA has no STT provider configured. Set SIA_STT_PROVIDER once a provider adapter is implemented.",
      { code: "PROVIDER_NOT_CONFIGURED", provider: null }
    );
  }

  const normalizedProvider = typeof provider === "string" ? provider.trim() : provider;

  if (normalizedProvider === "groq") {
    return transcribeWithGroq({ buffer, filename, mimeType, languageHint, signal });
  }

  throw new TranscriptionProviderError(
    "SIA has no implemented adapter for the configured STT provider. No request was sent.",
    { code: "PROVIDER_NOT_IMPLEMENTED", provider: normalizedProvider }
  );
}

module.exports = {
  transcribeAudio,
  TranscriptionProviderError,
};
