# SIA-API-05 — DELETE /sia/sessions/:sessionId

`verifyToken → siaLimiter → deleteSession`. Deletion is owner-scoped through
`sessionService.deleteSession(sessionId, req.userId)`. Missing and foreign ids share `404`.
The operation deletes a conversation session only; it never deletes expense, income, budget, or
goal data. Storage failures return the generic SIA `503`.

Sources: `backend/Controllers/SiaControllers/sessions.js`, `backend/sia/sessionService.js`.
