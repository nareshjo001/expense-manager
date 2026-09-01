# SIA-API-01 — POST /sia/ask

## Route contract

`verifyToken → siaLimiter → ask`. The request body accepts `question`, optional `sessionId`,
and optional `clientMessageId`. The controller uses only `req.userId` for identity.

## Current execution flow

1. `isSiaReady()` rejects an unready text-answer deployment with the generic `503` response
   before validation, financial reads, sessions, reservations, or provider work.
2. The controller validates a non-empty bounded question plus the session and client-message ids.
3. A keyed request fails closed if the session store is unavailable. Otherwise it reserves the
   key before any classifier, financial-snapshot, provider, or session operation.
4. A matching completed request replays its stored HTTP payload. A conflicting reuse returns
   `409`; a still-running follower waits for completion and otherwise returns `409` rather than
   calling the provider itself.
5. An explicitly supplied session is resolved owner-scoped. An unknown or foreign id returns the
   same `404` and never becomes a replacement new session.
6. The direct-answer path builds a current financial snapshot, calls the configured provider,
   validates grounding deterministically, checkpoints a validated keyed answer, then persists the
   conversation turn and completes the idempotency record.

## Failure and integrity boundaries

- Provider or grounding failures return the generic unavailable `503`; no provider detail is sent
  to the client.
- A reservation is released for failures before a validated answer checkpoint. After that
  checkpoint, a retry resumes finalization rather than paying for another provider call.
- Session persistence happens only after an answer exists. The feature has no expense, budget,
  income, or goal write action.

## Verified sources

- `backend/Routes/sia.routes.js`
- `backend/Controllers/SiaControllers/ask.js`
- `backend/sia/idempotencyService.js`
- `backend/sia/directAnswerService.js`
- `backend/sia/financialSnapshotService.js`
- `backend/sia/responseValidator.js`
- `backend/sia/sessionService.js`
