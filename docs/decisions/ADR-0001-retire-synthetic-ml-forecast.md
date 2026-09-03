# ADR-0001: Retire synthetic ML spending forecasting

## Decision

The `POST /ml/predict-spending-forecast` Express proxy and `POST /predict-spending-forecast` FastAPI endpoint are retired. Their synthetic-data quantile-GBDT artifacts and generator are removed.

## Context

The forecast model was trained on simulated personas, had no active frontend or report consumer, and could be mistaken for a validated financial prediction. The product already exposes a deterministic Theil-Sen trend with MAD uncertainty bounds through `backend/analytics/analyzers/forecastAnalyzer.js`.

## Consequences

Spending forecasts remain available through the report API and existing frontend forecast UI. They are deterministic, explainable, and do not require model inference, training data, or model artifacts. Reintroducing learned forecasting requires real user data, evaluation against a deterministic baseline, cold-start handling, and a new architecture decision.
