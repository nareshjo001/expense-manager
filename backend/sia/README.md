# SIA (backend module)

> **Documentation status note (Batch 3E).** Everything below the
> "Runtime readiness and status" section is the **original M1-1 text and is
> now substantially out of date** — SIA has since gained a context builder,
> an intent classifier, a real OpenAI provider adapter, bounded conversation
> sessions, request-level idempotency, grounded-response validation, and
> frontend integration. Rewriting all of it is a documentation task in its
> own right and is deliberately **out of scope for Batch 3E**, which added
> only the focused readiness/status section immediately below. Treat the
> older sections as historical until they are revised separately.

## Runtime readiness and status (Batch 3E)

### `GET /sia/status`

Authenticated (`verifyToken`, the same boundary as every other SIA route).
Rate limited by the shared `apiLimiter` that `app.js` mounts on `/sia` —
deliberately **not** by the strict `siaLimiter` reserved for `POST /sia/ask`,
so checking availability can never consume a user's question budget.

Response — the complete contract, always exactly these two fields:

```json
{ "success": true, "available": true }
```
```json
{ "success": true, "available": false }
```

`available: false` is intentionally **indistinguishable** between all of its
causes. The endpoint never returns the provider name, model name, credential
presence or value, missing environment-variable names, an internal reason
code, configuration details, or a stack trace.

An unauthenticated request receives the repository's standard `401` and
learns nothing about availability.

### Readiness conditions

`sia/readiness.js`'s `isSiaReady()` is the single authoritative evaluator,
used by **both** `GET /sia/status` and `POST /sia/ask`, so the two endpoints
can never disagree. SIA is ready only when **all** of the following hold:

1. SIA is enabled — `SIA_ENABLED` is exactly the string `"true"`.
2. A provider is configured (`SIA_LLM_PROVIDER`) **and** this codebase
   implements an adapter for it. Currently `openai`, `gemini`, and `groq` are
   the only implemented providers; any other value is treated as not ready.
3. A non-blank model is configured — `SIA_LLM_MODEL` (there is deliberately
   no default model). For Gemini's OpenAI-compatible endpoint this is a
   Gemini model id, e.g. `gemini-3.6-flash`; for Groq's OpenAI-compatible
   endpoint this is a Groq-hosted model id, e.g. `openai/gpt-oss-120b`.
4. A non-blank API credential exists for the configured provider —
   `OPENAI_API_KEY` for the OpenAI adapter, `GEMINI_API_KEY` for the Gemini
   adapter, `GROQ_API_KEY` for the Groq adapter. Each provider's credential
   is looked up only by its own env var name — there is no fallback to
   another provider's key.

Each condition mirrors a real failure branch that already exists in
`sia/llmService.js`; readiness adds no new requirement, it only evaluates the
same conditions **earlier**, before a request is admitted.

### Gemini provider (adapter)

`SIA_LLM_PROVIDER=gemini` uses Gemini's official OpenAI-compatible Chat
Completions endpoint —
`https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
(see https://ai.google.dev/gemini-api/docs/openai) — called directly with the
existing `axios` dependency, not the OpenAI or Google GenAI SDK. `GEMINI_API_KEY`
is sent only in the request's `Authorization: Bearer` header, read directly
from `process.env` inside the adapter (never through `sia/config.js`, and
never logged, returned, or included in an error). The same system prompt,
bounded conversation history, and structured-context/question construction
the OpenAI adapter uses are reused as-is and converted into
`system`/`user`/`assistant` chat-completion messages; only the assistant's
`choices[0].message.content` text is read from the response, and it still
passes through the same deterministic `validateGroundedAnswer()` gate before
being returned or persisted. Both adapters share one failure-code vocabulary
(`PROVIDER_TIMEOUT`, `PROVIDER_HTTP_ERROR`, `PROVIDER_NETWORK_ERROR`,
`PROVIDER_MALFORMED_RESPONSE`, `PROVIDER_EMPTY_OUTPUT`,
`MODEL_NOT_CONFIGURED`, `PROVIDER_API_KEY_NOT_CONFIGURED`), distinguished only
by the error's `provider` field -- never surfaced to the client, which always
sees the same generic unavailable response.

### Groq provider (adapter)

`SIA_LLM_PROVIDER=groq` uses Groq's own OpenAI-compatible Chat Completions
endpoint — `https://api.groq.com/openai/v1/chat/completions` (see
https://console.groq.com/docs/api-reference#chat-create) — called directly
with the existing `axios` dependency, not a Groq SDK. `GROQ_API_KEY` is sent
only in the request's `Authorization: Bearer` header, read directly from
`process.env` inside the adapter (never through `sia/config.js`, never
logged, returned, or included in an error, and never falls back to
`OPENAI_API_KEY`/`GEMINI_API_KEY` if unset). The Groq adapter reuses the
exact same system-prompt/history/context/question message construction and
response-extraction shape as the Gemini adapter (`choices[0].message.content`)
and shares the same failure-code vocabulary and generic-503 client contract
described above. Some Groq models (including the `openai/gpt-oss-*` reasoning
models) return an additional `reasoning`/`reasoning_content` field on the
response message alongside `content` — the adapter reads only `content`;
the reasoning field is never accessed, so it can never be returned,
persisted, or logged.

The credential is read for **presence only**. It is never returned, logged,
serialized, length-reported, or included in an error, and it is deliberately
**not** validated against a prefix, length, or format — provider key formats
change, and a format guess would reject valid keys.

Only variable **names** are documented here. No value belongs in this file,
and Batch 3E neither adds nor modifies any `.env` file.

### Voice input (speech-to-text) readiness

Separate, additive capability -- speech-to-text only, never the answer
pipeline. All of `APP_TIME_ZONE`, `SIA_VOICE_ENABLED`, `SIA_STT_PROVIDER`,
`SIA_STT_MODEL`, `SIA_STT_TIMEOUT_MS`, `SIA_STT_MAX_BYTES`, and
`SIA_STT_MAX_DURATION_SECONDS` are **backend-only** variables, read by
`sia/config.js`; none of them is ever read by, sent to, or permitted to
exist in the frontend as a `REACT_APP_*` variable.

`sia/readiness.js`'s `isVoiceReady()` is the single authoritative evaluator,
used by both `GET /sia/status`'s `capabilities.voiceInput.available` and
`POST /sia/transcriptions`, exactly mirroring `isSiaReady()`'s role for text
-- but it is a **separate** check: voice can be unavailable while text Q&A
keeps working, and vice versa, and neither check reads the other's config
fields. Voice is ready only when **all** of the following hold:

1. Voice input is enabled -- `SIA_VOICE_ENABLED` is exactly the string
   `"true"`. **Disabled by default** -- any other value or unset means
   voice is off, regardless of whether an STT provider/model/credential is
   otherwise configured.
2. An STT provider is configured **and** this codebase implements an
   adapter for it. Currently `groq` (`sia/transcriptionService.js`) is the
   **only** implemented STT provider; any other value is treated as not
   ready, never silently accepted -- config.js already defaults
   `SIA_STT_PROVIDER` to `groq`.
3. A non-blank `GROQ_API_KEY` exists. This is the **same** environment
   variable the text Groq adapter in `sia/llmService.js` already reads (both
   are the same Groq account/credential), but the two readiness checks
   evaluate it independently -- a text-only or voice-only deployment reports
   correctly either way.

`GROQ_API_KEY` is read directly from `process.env` inside
`sia/transcriptionService.js`, the same server-only pattern
`sia/llmService.js`'s adapters use -- never through `sia/config.js`, never
logged, returned, or included in an error.

`SIA_STT_MODEL` (default `whisper-large-v3-turbo`) is passed to the Groq
adapter as-is; it has no separate implemented/not-implemented check the way
`SIA_STT_PROVIDER` does.

Audio uploads to `POST /sia/transcriptions` are bounded by `SIA_STT_MAX_BYTES`
(default 5 MiB, enforced by `Middlewares/audioUpload.js` before any
container-signature check or provider call -- note the effective usable
maximum is one byte less than this value, since the underlying upload
library rejects a file of exactly this size the same as a larger one, a
deliberately fail-closed rounding) and `SIA_STT_MAX_DURATION_SECONDS`
(default 45 seconds). The provider request itself is bounded by
`SIA_STT_TIMEOUT_MS` (default 30000 ms), the same "one attempt, no retry"
contract `SIA_LLM_TIMEOUT_MS` gives the text path.

`APP_TIME_ZONE` (default `Asia/Kolkata`, validated with
`Intl.DateTimeFormat`) is not itself a voice-specific variable -- it governs
calendar/period resolution (`sia/periodResolver.js`) for both the text and
voice paths equally.

There is no separate feature flag gating the semantic-routing fallback layer
(`sia/semanticRouter.js`, `sia/semanticPipeline.js`, both introduced
alongside this section). It activates automatically for any question
`sia/intentClassifier.js` returns `null` for, under the same
`SIA_ENABLED`/`SIA_LLM_PROVIDER`/`SIA_LLM_MODEL`/credential readiness path
`isSiaReady()` already evaluates above -- no additional environment
variable turns it on or off.

Capturing microphone audio on the frontend
(`navigator.mediaDevices.getUserMedia`, used by `useSiaVoiceRecorder.js`)
requires a secure browsing context in production -- HTTPS, or `localhost`
for local development. On an insecure origin the browser does not expose
`navigator.mediaDevices` at all, so the recorder's own support check fails
closed and voice controls simply do not render; this is a browser-platform
constraint, not something this module enables or disables.

### What readiness does *not* prove

This is a **local configuration check only**. It performs **no network
request, provider call, or external health probe of any kind**. A `true`
result means "correctly configured", never "verified reachable" — it does not
prove that OpenAI is up, that the credential is accepted, that the model
exists or is entitled to the account, or that quota remains. A request that
passes the gate can still fail afterwards with the existing generic `503`,
which remains the correct behaviour for a genuine provider or network
failure.

### Frontend behaviour (fail closed)

`REACT_APP_SIA_ENABLED` still decides only whether the SIA feature is
**exposed** in a build. Backend status decides whether **new questions can
currently be submitted**; both must hold, and neither implies the other.

The frontend fails closed: new submissions are enabled **only** on an
unambiguous `{ success: true, available: true }`. A loading state, a request
failure, a non-2xx, a malformed body, or a truthy-but-not-`true` value all
block submission. The launcher is never hidden and conversation history
stays browsable, resumable, and deletable while SIA is unavailable, and a
user-driven Retry refetches status. Status is fetched once per mounted app
session (cached, no background polling).

---

## Current status

> Historical (M1-1) — see the documentation status note at the top of this
> file.

Structural foundation only (M1-1). This module exists in the repository but
is not wired into the application in any way: nothing requires it, no route
mounts it, and it performs no runtime work.

## Current files

| File | Purpose |
|---|---|
| `index.js` | Empty CommonJS export scaffold. Safe to require; no side effects. |
| `config.js` | Reads SIA-related environment variables into a small configuration object. No validation of provider credentials; no network calls. |

## Configuration variables

All are optional. If unset, `config.js` returns the listed default.

| Variable | Default | Notes |
|---|---|---|
| `SIA_ENABLED` | `false` | Only the exact (trimmed) string `"true"` enables it. |
| `SIA_LLM_PROVIDER` | `null` | Trimmed; blank becomes `null`. |
| `SIA_LLM_MODEL` | `null` | Trimmed; blank becomes `null`. No default model is assumed. |
| `SIA_LLM_TIMEOUT_MS` | `8000` | Must be a finite, positive number; anything else falls back to the default. |
| `APP_TIME_ZONE` | `Asia/Kolkata` | Backend-only. The IANA time zone `sia/periodResolver.js` uses for calendar/period resolution. Validated with `Intl.DateTimeFormat`; unset, blank, or an unrecognized zone name falls back to the default. |
| `SIA_VOICE_ENABLED` | `false` | Backend-only (see "Voice input (speech-to-text) readiness" below). Only the exact (trimmed) string `"true"` enables it, same rule as `SIA_ENABLED`, and independent of it. |
| `SIA_STT_PROVIDER` | `groq` | Backend-only. Trimmed; blank falls back to `groq`. Currently the only implemented STT adapter -- see below. |
| `SIA_STT_MODEL` | `whisper-large-v3-turbo` | Backend-only. Trimmed; blank falls back to the default. |
| `SIA_STT_TIMEOUT_MS` | `30000` | Backend-only. Must be a finite, positive number; anything else falls back to the default. |
| `SIA_STT_MAX_BYTES` | `5242880` (5 MiB) | Backend-only. Must be a finite, positive number; anything else falls back to the default. Enforced by `Middlewares/audioUpload.js`. |
| `SIA_STT_MAX_DURATION_SECONDS` | `45` | Backend-only. Must be a finite, positive number; anything else falls back to the default. |

## Non-goals (as of M1-1)

This module does **not** currently provide, and this milestone does not
implement:

- No HTTP route or controller.
- No LLM provider integration or API calls.
- No context builder or access to `backend/analytics/**` data.
- No frontend integration.

## Roadmap

Functionality described above as a non-goal will be introduced in later,
separately approved milestones -- nothing beyond the structural scaffold and
configuration surface exists yet.
