# SIA-API-02 — GET /sia/status

`verifyToken → status`. This route is deliberately outside `siaLimiter`: it performs only
synchronous local readiness checks and safe capability reads. It returns `200` with text-answer
availability and voice-input limits/accepted MIME types. It never contacts a provider, reads
financial data, reserves an idempotency key, or reads/writes a conversation. Provider/model/
credential details and reason codes are never exposed.

Sources: `backend/Routes/sia.routes.js`, `backend/Controllers/SiaControllers/status.js`,
`backend/sia/readiness.js`, `backend/sia/config.js`.
