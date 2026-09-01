# SIA module — verified workflow documentation

SIA is an authenticated, read-only financial-assistance feature. Its routes are mounted by
`backend/Routes/sia.routes.js`; the authenticated identity is always `req.userId` set by
`verifyToken`. No SIA route accepts a client-supplied user id.

## Verified API surface

| ID | Method | Route | Middleware after `verifyToken` | Controller |
|---|---|---|---|---|
| SIA-API-01 | POST | `/sia/ask` | `siaLimiter` | `ask` |
| SIA-API-02 | GET | `/sia/status` | none | `status` |
| SIA-API-03 | GET | `/sia/sessions` | `siaLimiter` | `listSessions` |
| SIA-API-04 | GET | `/sia/sessions/:sessionId/messages` | `siaLimiter` | `listMessages` |
| SIA-API-05 | DELETE | `/sia/sessions/:sessionId` | `siaLimiter` | `deleteSession` |
| SIA-API-06 | POST | `/sia/transcriptions` | `siaVoiceLimiter` → readiness gate → multipart upload | `transcribe` |

`/sia/status` is intentionally outside the expensive-answer limiter. It only returns local
availability and non-secret voice capability limits; it does not call a provider, read financial
data, or create a session.

## Core answer flow

`POST /sia/ask` first checks local readiness, validates the question/session/idempotency fields,
and reserves a keyed request before classification, snapshot construction, provider work, or
session creation. A completed matching key replays its stored response; an in-progress key never
starts a second provider request. The direct-answer path uses the current financial snapshot and
the deterministic grounding validator before a response is persisted or returned. Provider and
grounding failures use the generic unavailable response.

## Generated route overviews

| Route | Overview | Detailed |
|---|---|---|
| `POST /sia/ask` | [SVG](ask/sia-api-01-ask-overview.svg) · [PNG](ask/sia-api-01-ask-overview.png) | [SVG](ask/sia-api-01-ask-detailed.svg) · [PNG](ask/sia-api-01-ask-detailed.png) |
| `GET /sia/status` | [SVG](status/sia-api-02-status-overview.svg) · [PNG](status/sia-api-02-status-overview.png) | [SVG](status/sia-api-02-status-detailed.svg) · [PNG](status/sia-api-02-status-detailed.png) |
| `GET /sia/sessions` | [SVG](sessions-list/sia-api-03-sessions-list-overview.svg) · [PNG](sessions-list/sia-api-03-sessions-list-overview.png) | [SVG](sessions-list/sia-api-03-sessions-list-detailed.svg) · [PNG](sessions-list/sia-api-03-sessions-list-detailed.png) |
| `GET /sia/sessions/:sessionId/messages` | [SVG](session-messages/sia-api-04-session-messages-overview.svg) · [PNG](session-messages/sia-api-04-session-messages-overview.png) | [SVG](session-messages/sia-api-04-session-messages-detailed.svg) · [PNG](session-messages/sia-api-04-session-messages-detailed.png) |
| `DELETE /sia/sessions/:sessionId` | [SVG](session-delete/sia-api-05-session-delete-overview.svg) · [PNG](session-delete/sia-api-05-session-delete-overview.png) | [SVG](session-delete/sia-api-05-session-delete-detailed.svg) · [PNG](session-delete/sia-api-05-session-delete-detailed.png) |
| `POST /sia/transcriptions` | [SVG](transcriptions/sia-api-06-transcriptions-overview.svg) · [PNG](transcriptions/sia-api-06-transcriptions-overview.png) | [SVG](transcriptions/sia-api-06-transcriptions-detailed.svg) · [PNG](transcriptions/sia-api-06-transcriptions-detailed.png) |

Detailed verified contracts: [ask](ask/sia-api-01-ask.md) ·
[status](status/sia-api-02-status.md) · [sessions list](sessions-list/sia-api-03-sessions-list.md) ·
[session messages](session-messages/sia-api-04-session-messages.md) ·
[session deletion](session-delete/sia-api-05-session-delete.md) ·
[transcription](transcriptions/sia-api-06-transcriptions.md).

## Conversation and voice boundaries

Session reads/deletes are owner-scoped. Unknown and foreign session ids both return the same 404.
Voice transcription is speech-to-text only: it performs multipart-size checks, validates the real
audio container signature rather than the client MIME header, calls the transcription provider,
and returns a transcript. It does not invoke the answer pipeline or create conversation data.

## Source files

- `backend/Routes/sia.routes.js`
- `backend/Controllers/SiaControllers/ask.js`
- `backend/Controllers/SiaControllers/status.js`
- `backend/Controllers/SiaControllers/sessions.js`
- `backend/Controllers/SiaControllers/transcribe.js`
- `backend/sia/` (readiness, idempotency, financial snapshot, semantic/direct-answer, session,
  grounding, provider, and transcription services)
- `frontend/src/components/sia/` and `frontend/src/api/sia*.js`

## Current documentation status

This index is based on direct source inspection. Route-level diagrams will be generated from the
same verified contracts; no legacy SIA documentation exists to regenerate.
