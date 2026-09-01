# System module — API workflow documentation

This module documents backend-level routes that do not belong to a finance domain:
the root liveness response, the combined backend/ML/push health check, and push-device
registration.

The SVG and PNG files are generated outputs. Update the two `build_system_*.py` sources,
then regenerate; do not edit rendered diagrams manually. Both scripts reuse the shared
[`../diagram-tokens.json`](../diagram-tokens.json) and
[`../workflow_diagram.py`](../workflow_diagram.py) unchanged.

## Verified API inventory

| API ID | Endpoint | Current implementation | Confirmed caller |
|---|---|---|---|
| SYSTEM-01 | `GET /` | Inline route in `backend/app.js`; returns a static text literal | External/manual only |
| SYSTEM-02 | `GET /ping` | Inline route in `backend/app.js`; checks Firebase Admin availability and probes the ML root | `frontend/src/App.js` keep-alive, plus external tooling |
| SYSTEM-03 | `POST /api/device-token` | `apiLimiter` → `verifyToken` → `deviceRegistration` | `useWebPush.js` and `useMobilePush.js` |

## Documents

| ID | Overview | Detailed | Narrative |
|---|---|---|---|
| SYSTEM-01 | [SVG](root/system-api-01-root-overview.svg) | [SVG](root/system-api-01-root-detailed.svg) | [Markdown](root/system-api-01-root.md) |
| SYSTEM-02 | [SVG](ping/system-api-02-ping-overview.svg) | [SVG](ping/system-api-02-ping-detailed.svg) | [Markdown](ping/system-api-02-ping.md) |
| SYSTEM-03 | [SVG](device-token/system-api-03-device-token-overview.svg) | [SVG](device-token/system-api-03-device-token-detailed.svg) | [Markdown](device-token/system-api-03-device-token.md) |

The cross-route/client mapping is in system-consumption-map.md.

## Current flow boundaries

- `GET /` does not check MongoDB. Its “Connected to DB” text is a static response.
- `GET /ping` reports `push: "up"` only when Firebase Admin initializes locally; it does
  not send a notification and does not prove that a registered device is reachable.
- The app calls `/ping` after the splash screen and every ten minutes while mounted. It
  only shows a toast for a non-OK response; it does not use the returned `push` field.
- Device-token registration writes `DeviceToken` documents. The internal push sender reads
  them for recurring-expense notifications and deletes a token only when FCM explicitly
  reports it invalid or unregistered. There is no TTL or proactive unsubscribe cleanup.

## Regeneration

```bash
cd docs/api-workflows/system
python build_system_overviews.py
python build_system_detailed.py
```

Rasterise the regenerated SVG files into the matching PNG files at 2× before review.
