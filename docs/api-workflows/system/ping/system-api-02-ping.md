# SYSTEM-02 — Backend, ML, and push capability check

`GET /ping`

## Purpose

Reports whether the backend route can reach the ML service and whether Firebase Admin
initialized in this backend process. It is not a delivery test: `push: "up"` means the
Firebase Admin capability initialized, not that a notification was sent or received.

## Endpoint

| | |
|---|---|
| Method | `GET` |
| Path | `/ping` |
| Mount | Inline `app.get("/ping", ...)` in `backend/app.js`, before router mounts |
| Middleware | `cors()` → `express.json()` → handler; no `apiLimiter` or `verifyToken` |
| Auth | None |
| ML dependency | `axios.get(`${process.env.ML_ROUTE}/`)` with no explicit timeout |
| Push dependency | `isFirebaseAvailable()` from `config/firebaseAdmin.js` |

## Level 1 quick workflow

<picture>
  <source srcset="system-api-02-ping-overview.svg" type="image/svg+xml">
  <img src="system-api-02-ping-overview.png" alt="Overview of GET /ping">
</picture>

Vector: [SVG](system-api-02-ping-overview.svg) · raster: [PNG](system-api-02-ping-overview.png)

## Level 2 detailed workflow

<picture>
  <source srcset="system-api-02-ping-detailed.svg" type="image/svg+xml">
  <img src="system-api-02-ping-detailed.png" alt="Detailed workflow for GET /ping">
</picture>

Vector: [SVG](system-api-02-ping-detailed.svg) · raster: [PNG](system-api-02-ping-detailed.png)

## Verified execution flow

1. `frontend/src/App.js` calls `keepAlive()` once after its splash state clears, then
   every ten minutes while the app remains mounted. External callers can also call this
   unauthenticated endpoint.
2. The handler calls `isFirebaseAvailable()` before entering the ML `try/catch`, producing
   `push: "up"` or `push: "down"`.
3. It awaits the ML service root request.
4. A successful ML response returns `200`; any rejected/non-2xx ML request reaches the
   catch and returns `503`.
5. The frontend only reacts to a non-OK HTTP response. It maps `ml: "down"` to an ML
   toast; the returned `push` field is not currently consumed by the UI.

## Response contract

Success (`200`):

```json
{ "success": true, "backend": "up", "ml": "up", "push": "up" }
```

`push` may instead be `"down"` while the response remains `200`, because Firebase is
an optional capability.

ML failure (`503`):

```json
{
  "success": false,
  "backend": "up",
  "ml": "down",
  "push": "down",
  "message": "Server Unavailable."
}
```

The exact `push` value in either shape is the result of the Firebase capability check.

## Persistence and side effects

None. The route does not send a push notification, read/write MongoDB, or mutate the ML
service. It performs one local Firebase initialization check and one outbound ML request.

## Security and operational facts

| Concern | Verified behavior |
|---|---|
| Authentication | None on the endpoint or on the ML request |
| Rate limiting | None; it is mounted before the authenticated route limiters |
| ML timeout | None explicitly configured |
| Failure detail | DNS, network, and ML non-2xx failures collapse to `ml: "down"` |
| Push meaning | Firebase Admin initialization only; not message delivery or token validity |

## Files involved

| Layer | File | Role |
|---|---|---|
| Client | `frontend/src/App.js` | Scheduled `keepAlive()` caller and failed-response toast |
| Server | `backend/app.js` | Inline `/ping` route and response contract |
| Firebase | `backend/config/firebaseAdmin.js` | Guarded Firebase Admin availability check |
| ML service | `ml-service/app.py` | Root endpoint probed by the backend |
