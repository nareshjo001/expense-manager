# ML-API-12 — POST /ml/predict-spending-forecast

## Workflow artifacts

- [Level 1 overview](ml-api-12-spending-forecast-overview.svg)
- [Level 2 detailed workflow](ml-api-12-spending-forecast-detailed.svg)

## Verified route chain

`POST /ml/predict-spending-forecast` is mounted by `backend/Routes/ml.router.js` behind the
shared `/ml` API limiter and `verifyToken`. It forwards `req.body` to
`requestSpendingForecast` only after the caller's JWT is validated.

`requestSpendingForecast` builds the configured ML URL, attaches `X-ML-Operations-Token` when
configured, and calls FastAPI `POST /predict-spending-forecast` with a 3000 ms default timeout.
FastAPI enforces the operations-token guard before passing the arbitrary JSON payload to
`predict_spending_snapshot`.

## Public outcomes

- Proxy success: `200 { success: true, data: { success: true, ...forecast } }`.
- Provider/network/timeout result from the client utility: `502` with a non-secret reason.
- A synchronous proxy error (for example an invalid/missing ML URL): `500`.
- FastAPI missing/invalid operations token: guarded before forecasting (`503` if unconfigured,
  `401` if missing or invalid); the proxy maps that failed downstream result through its `502`
  path.

## Sources

- `backend/Routes/ml.router.js`
- `backend/utils/mlServiceClient.js`
- `ml-service/app.py`
- `ml-service/inference/spend_forecaster.py`
