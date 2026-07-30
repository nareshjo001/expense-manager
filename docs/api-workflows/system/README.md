# System module — API workflow documentation

Three endpoints, no domain of their own. Discovered during the repository-wide API
coverage gate that followed the ML Service audit, not during any earlier module pass —
`GET /`, `GET /ping`, and `POST /api/device-token` are all real, mounted, reachable,
application-defined routes that had zero documentation anywhere in this corpus before
this module was written.

Diagrams reuse the approved BALENISA design system in
[`../diagram-tokens.json`](../diagram-tokens.json) and
[`../workflow_diagram.py`](../workflow_diagram.py) unchanged.

## What this module is — and is not

| | |
|---|---|
| **Is** | A home for backend-level routes that don't belong to any domain module: two infrastructure health endpoints, and one push-notification feature that shares a router file with Budget but is otherwise unrelated to it |
| **Is not** | A rename or reorganization of any existing module. Budget, Auth, Expense, Income, Charts, Bills, Report and ML Service are unchanged |
| **Push notifications** | `POST /api/device-token` is the only HTTP surface for this feature. The sending side (`push.service.js`, `retryPush.js`, `recurringJob.js`) is internal-only, has no route, and is referenced here only as a downstream consumer of the `DeviceToken` collection this endpoint writes |

## A. System API inventory

| API ID | Method | Endpoint | Route mount | Backend handler | Frontend caller | Status |
|---|---|---|---|---|---|---|
| [SYSTEM-01](system-api-01-root.md) | GET | `/` | Declared directly on `app`, `server.js:56` | inline handler | None found | Externally reachable but unused (no app frontend caller) |
| [SYSTEM-02](system-api-02-ping.md) | GET | `/ping` | Declared directly on `app`, `server.js:61` | inline handler (calls ML-API-02) | None found | Externally reachable but unused (no app frontend caller) |
| [SYSTEM-03](system-api-03-device-token.md) | POST | `/api/device-token` | `app.use("/api", apiLimiter, apiRouter)` → `api.routes.js` | `deviceRegistration` | `useWebPush.js`, `useMobilePush.js` (raw `fetch`, not the shared axios client) | Actively used |

No duplicate or legacy routes found among these three. SYSTEM-01 and SYSTEM-02 are
classified "externally reachable but unused" rather than "actively used": both are real
and reachable, but grepping all of `frontend/src` for a call to the bare backend origin
or to `/ping` returns no match — they exist for external tooling (uptime monitors, manual
checks), not for this application's own UI.

## B. Frontend System inventory

Only SYSTEM-03 has a frontend consumer, and it is unusual within this corpus: both
`useWebPush.js` and `useMobilePush.js` call it with the raw `fetch` API rather than the
shared `api` axios instance (`frontend/src/api/axios.js`) that every other documented
endpoint uses — so neither call benefits from the centralized 401/429/409 interceptor.
Full detail in [system-consumption-map.md](system-consumption-map.md#b-frontend-system-inventory).

## C. Downstream consumers (not their own endpoints)

`push.service.js` (`sendPush`) and `backend/cron/retryPush.js` both read the
`DeviceToken` collection that SYSTEM-03 writes, but expose no HTTP route of their own —
they are internal-only, the same convention used for the ML Service module's non-API
internal flows. Table in
[system-consumption-map.md](system-consumption-map.md#c-downstream-consumers).

## Documents

| # | Workflow | Level 1 | Level 2 | Document |
|---|---|---|---|---|
| SYSTEM-01 | `GET /` | [svg](system-api-01-root-overview.svg) | [svg](system-api-01-root-detailed.svg) | [md](system-api-01-root.md) |
| SYSTEM-02 | `GET /ping` | [svg](system-api-02-ping-overview.svg) | [svg](system-api-02-ping-detailed.svg) | [md](system-api-02-ping.md) |
| SYSTEM-03 | `POST /api/device-token` | [svg](system-api-03-device-token-overview.svg) | [svg](system-api-03-device-token-detailed.svg) | [md](system-api-03-device-token.md) |

Plus the [consumption map](system-consumption-map.md).

## Confirmed limitations

1. **`GET /`'s response text is unconditional.** "Welcome! Connected to DB..." is a
   static literal — no `mongoose.connection` state is read before sending it.
2. **Neither health endpoint carries rate limiting.** Both are declared above every
   `apiLimiter` mount in `server.js`.
3. **`GET /ping` has no timeout on its downstream ML call**, unlike `predict-category`
   and `generate-description`, which both use an explicit 5000ms timeout.
4. **`GET /ping` is a fifth confirmed backend→ML call with no service-to-service
   authentication** — consistent with the four call sites already documented in
   ML-FLOW-09.
5. **`POST /api/device-token`'s success response omits the `success` flag** that every
   other endpoint's success body in this corpus includes, while its error bodies do
   include `success: false`.
6. **No `DeviceToken` document is ever deleted.** No TTL index, no cleanup job, no
   code path anywhere in the repository removes a stale or revoked device registration.
7. **Both push-registration hooks bypass the shared axios client**, using raw `fetch`
   instead — neither benefits from the app's centralized interceptor handling.
8. **Non-409 registration failures are effectively silent to the user** — `useWebPush.js`
   only logs the status code for anything other than a 409 conflict.

## Structural facts

- 3 endpoints, 3 API docs, 6 diagrams (Level 1 + Level 2 each), 6 PNGs, 2 build scripts,
  1 README, 1 consumption map — 14 files total in this module.
- Created in response to the repository-wide API coverage gate, which found these three
  routes had no documentation anywhere in the existing 44-workflow corpus.
