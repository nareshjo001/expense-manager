# SIA-API-04 — GET /sia/sessions/:sessionId/messages

`verifyToken → siaLimiter → listMessages`. The controller passes the route id, authenticated
user id, optional `limit`, and optional `before` cursor to `sessionService.listMessages`.
Messages include stored grounding only where one exists. A missing and a foreign session are both
the same `404`, preventing existence disclosure; storage failures are a generic `503`.

Sources: `backend/Controllers/SiaControllers/sessions.js`, `backend/sia/sessionService.js`,
`backend/models/SiaMessage.js`.
