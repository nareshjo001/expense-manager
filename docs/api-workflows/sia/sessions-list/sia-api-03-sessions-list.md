# SIA-API-03 — GET /sia/sessions

`verifyToken → siaLimiter → listSessions`. An optional `limit` is passed to
`sessionService.listSessions(req.userId, { limit })`. The response contains only the caller's
session summaries. Storage failures map to the generic SIA `503`; no provider or financial-data
work occurs.

Sources: `backend/Controllers/SiaControllers/sessions.js`, `backend/sia/sessionService.js`.
