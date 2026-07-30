# System module — consumption map

Supporting detail for [README.md](README.md). Every row below was confirmed by direct
inspection of the file named, not inferred from a route name.

## A. System API inventory

| API ID | Method | Endpoint | Auth | Rate limit | Handler | Status |
|---|---|---|---|---|---|---|
| SYSTEM-01 | GET | `/` | None | None | `backend/server.js` inline | Externally reachable but unused |
| SYSTEM-02 | GET | `/ping` | None | None | `backend/server.js` inline (proxies ML-API-02) | Externally reachable but unused |
| SYSTEM-03 | POST | `/api/device-token` | `verifyToken` | `apiLimiter` | `backend/Controllers/PushNotifications/deviceRegistration.js` | Actively used |

"Externally reachable but unused" here means: real and reachable over HTTP, with zero
call sites found anywhere under `frontend/src` — confirmed via `grep -rn` for the literal
paths and for any fetch/axios call targeting the bare backend origin.

## B. Frontend System inventory

| Surface | File | Trigger | Network call | Notes |
|---|---|---|---|---|
| Web push registration | `frontend/src/components/hooks/useWebPush.js` | Login, if `Notification.permission === "granted"`; or after an in-app prompt shown 5s post-login if permission is `"default"` | `fetch(BASE_URL + "/api/device-token")`, `platform: "web"` | Raw `fetch`, not the shared `api` axios instance |
| Native push registration | `frontend/src/components/hooks/useMobilePush.js` | Capacitor `PushNotifications` `"registration"` listener, after native permission granted | `fetch(BASE_URL + "/api/device-token")`, `platform: "mobile"` | Same raw-`fetch` pattern; wrapped in a `try/catch` inside the listener |

Both hooks check only `res.status === 409` explicitly; every other non-2xx status is
logged (`useWebPush.js`) or silently dropped (`useMobilePush.js`), with no toast, no
retry, and no UI state change.

No frontend surface calls SYSTEM-01 or SYSTEM-02 — confirmed by `grep -rn` across
`frontend/src` for `"/ping"` and for any request to the bare backend origin (as opposed
to `/api`, `/expense`, `/auth`, etc.), both returning no matches outside this endpoint's
own definition.

## C. Downstream consumers

Neither of the two files below exposes an HTTP route. They are documented here only
because they read the `DeviceToken` collection SYSTEM-03 writes — the same
"internal flow, not a new endpoint" convention used throughout the ML Service module.

| File | Function | Reads | Triggered by | HTTP route? |
|---|---|---|---|---|
| `backend/Services/push.service.js` | `sendPush(userId, title, body, route)` | `DeviceToken.find({ userId })` | Called from `backend/cron/recurringJob.js` (not traced further — out of scope for this coverage gate, which covers HTTP endpoints only) | No |
| `backend/cron/retryPush.js` | node-cron, `*/15 * * * *` | `Notification` records with `pushStatus: "failed"`, `retryCount < 3` | Its own schedule | No |

`retryPush.js` retries via the `Notification` model, not `DeviceToken` directly — it
calls `sendPush` again, which is where `DeviceToken` is actually read. No code path in
either file writes to or deletes from `DeviceToken`; only SYSTEM-03 does.

## D. Cross-references to existing modules

- `verifyToken` (SYSTEM-03's auth middleware) is documented in the Authentication module,
  not repeated here.
- `apiLimiter` (SYSTEM-03's rate limiter) is the same limiter instance used by Budget,
  Expense, Bills, ML proxy, Report, Chart and Income — documented at the point it was
  first introduced (Budget module) and not re-documented per module.
- ML-API-02 (`GET /` on the ML service, the target of SYSTEM-02's proxy call) is fully
  documented in the ML Service module; SYSTEM-02 does not repeat that documentation,
  only the proxying behavior on the backend side.
