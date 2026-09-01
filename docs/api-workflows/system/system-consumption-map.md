# System consumption map

This map records verified callers and consumers for the three System routes. It does not
promote internal jobs into HTTP endpoints.

## Route consumers

| Endpoint | Confirmed caller | Current behavior |
|---|---|---|
| `GET /` | No repository caller | External/manual liveness response only |
| `GET /ping` | `frontend/src/App.js` | `keepAlive()` runs after splash completion and every 10 minutes; a failed response produces an error toast |
| `POST /api/device-token` | `useWebPush.js` | Gets an FCM web token after permission, then POSTs `platform: "web"` with raw `fetch` |
| `POST /api/device-token` | `useMobilePush.js` | Registers native push and POSTs `platform: "mobile"` from Capacitor’s registration listener |

## Push persistence and downstream consumers

```text
web/native registration
  -> POST /api/device-token
  -> DeviceToken collection
  -> recurringJob.js creates a Notification and calls sendPush()
  -> push.service.js sends one FCM message per registered token
  -> retryPush.js retries failed Notification records every 15 minutes
```

`push.service.js` deletes a `DeviceToken` only for FCM’s
`messaging/registration-token-not-registered` and
`messaging/invalid-registration-token` errors. No endpoint or client logout path
proactively removes a token.

## Dependencies

| Dependency | Used by | Verified role |
|---|---|---|
| Firebase Admin | `GET /ping`, `sendPush()` | Reports initialization availability; sends FCM messages only in `sendPush()` |
| ML service root | `GET /ping` | `axios.get(`${ML_ROUTE}/`)` determines the `ml` field |
| `apiLimiter` | `POST /api/device-token` | Runs before the API router |
| `verifyToken` | `POST /api/device-token` | Authenticates request and supplies `req.userId` |
