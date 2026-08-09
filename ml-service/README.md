# BALENISA — ML Service

A standalone FastAPI microservice that predicts an expense category from free-text
input, generates a filler description when one is missing, and periodically retrains its
one shared classification model from user corrections collected by the backend.

> **Scope note (Prediction Layer V1).** Spending forecasting and budget-risk
> estimation are **not** part of this service. They are implemented as pure,
> deterministic statistical analyzers inside the backend analytics engine
> (`backend/analytics/analyzers/forecastAnalyzer.js`) — a Theil-Sen robust
> trend over the user's own completed monthly totals, with no trained model,
> no training dataset, no measured accuracy figure and no call to this
> service. This service remains responsible only for expense-category
> prediction, retraining and description generation.

See the [root README](../README.md) for the overall system and the
[frontend](../frontend/README.md) / [backend](../backend/README.md) READMEs for the
other two services.

## Purpose

This service exists to keep machine learning concerns — feature extraction, model
training, validation, and versioned model storage — out of the Node backend. It is
called only by the backend; the frontend never reaches it directly. It has no user
accounts, no expense records, and no authentication of its own for the endpoints a real
user's request actually reaches — the backend's JWT check is the real gate for those.

## Implemented ML functionality

- **Category prediction** from raw expense-name text, using a `TfidfVectorizer` +
  `RandomForestClassifier` (`n_estimators=30`) pipeline, with a confidence score.
- **Rule-based description generation** — despite living in an `inference/` module
  alongside the predictor, this is template/keyword matching, not a model.
- **Feedback-driven retraining** — a full model refit from accumulated user corrections,
  triggered manually or by the backend's daily cron once a correction threshold is met.
- **Versioned, atomically-persisted model bundles**, with a 9-gate validation pipeline
  before a newly trained model can be activated.

There is **one shared model for all users** — no per-user personalization, no
online/incremental learning. Every retrain is a full refit from the accumulated feedback
dataset.

## Prediction workflow

1. `POST /predict-category` receives `{ "expenseName": "<text>" }`.
2. The currently-loaded model snapshot (in-process, per worker) is used to clean the
   text, vectorize it, and predict a category and confidence.
3. The response is always HTTP `200`, even on an internal failure — errors are returned
   as `{"error": "..."}` in the body rather than as a non-2xx status. Callers must check
   for that key, not just the status code.
4. If no model is currently loaded, the same `{"error": "..."}` shape is returned.

Each FastAPI worker/replica holds its own independent copy of the loaded model. A newly
activated model reaches other workers lazily, via a throttled manifest check (default
every 5 seconds), not immediately or by any push mechanism.

## Description generation

Implemented, but **not ML** — `inference/descriptionGenerator.py` is pure rule-based
text generation from a fixed set of category templates and keyword rules. It does not
use the trained model, TF-IDF, or any statistical component.

## Training data and feedback lifecycle

Corrections are written by the backend (not by this service) to a shared MongoDB
collection, `mlfeedbacks`, whenever a user overrides a predicted category **at the
moment an expense is created** — corrections made later, when editing an expense, are
never captured here (that's a backend-side behavior, not a limitation of this service).

When retraining runs, this service:
1. Reserves currently-`pending` feedback documents for the run (status → `reserved`),
   capping duplicate near-identical entries (`ML_FEEDBACK_DUPLICATE_CAP`, default 3).
2. Builds a training/evaluation split (80/20, stratified where possible) from that
   reserved set.
3. On success, marks the reserved documents `trained`; on failure or if the run is
   abandoned, releases them back to `pending` so a later run can retry them.

## Model training, validation, acceptance, persistence, recovery, status

- **Trigger** — `POST /retrain-model`. Acquires a MongoDB-backed distributed lock
  (`mltraininglocks`) so only one retrain runs at a time; returns quickly with an
  accepted/already-running response. **Acceptance is not completion** — the actual
  training, validation, and activation happen in a background thread, and there is no
  endpoint that blocks until they finish.
- **Training** — a subprocess-style pipeline: TF-IDF vectorization, Random Forest
  fitting, evaluation against the held-out split.
- **Validation** — nine named gates must pass before a candidate model can activate:
  `completeness`, `loadability`, `feature_compatibility`,
  `encoder_model_compatibility`, `dataset_metadata_consistency`, `valid_metrics`,
  `regression_threshold`, `smoke_predictions`, `category_set_comparison`. A regression
  beyond `ML_MAX_ACCURACY_REGRESSION` versus the current baseline fails the run.
- **Persistence** — each run's artifacts are written to
  `training/models/model-<runId>/` via an atomic temp-directory-then-rename, and the
  "active" pointer (`active.json`) is updated via an atomic temp-file-then-replace — a
  crash mid-write cannot leave a partially-written bundle marked active.
- **Recovery** — three independent startup reconciliation sweeps handle a process that
  died mid-run: orphaned training runs, feedback documents left `reserved` past a
  timeout, and inconsistent activation state are each detected and resolved on the next
  process start.
- **Run states** — `queued → running → evaluating → activating → activated`, plus
  `failed`, `failed_validation`, `failed_activation`, and a legacy `completed` state.

## Operational / status endpoints and authentication boundary

`GET /ml-status`, `GET /training-runs`, and `GET /training-runs/{run_id}` are gated by a
shared-secret header, `X-ML-Operations-Token`. This check **fails closed**: if
`ML_OPERATIONS_TOKEN` is not set in the environment, all three endpoints return `503`
rather than being open by default.

Every other endpoint — including prediction, description generation, and retraining
itself — has **no authentication of its own**. A direct, unauthenticated request to this
service would succeed if it reached the service on its own network path. In normal
operation, the backend's `verifyToken` middleware is the only real access control a
user's request passes through before prediction happens.

Four plain health endpoints (`HEAD /`, `GET /`, `GET /health/live`, `GET /health/ready`)
require no authentication and report process/dependency liveness.

## Database collections

This service reads and writes three MongoDB collections, all confirmed by direct
inspection of `db/*.py`:

| Collection | Owner | Purpose |
|---|---|---|
| `mlfeedbacks` | Written by the backend, read/updated by this service | User corrections; the training data source |
| `mltrainingruns` | This service | One persistent document per retraining attempt, tracking its state machine |
| `mltraininglocks` | This service | A single-document distributed lock so only one retrain runs at a time |

Trained model artifacts themselves live on disk (`ML_MODEL_ROOT`, default
`./training/models`), not in MongoDB.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `MONGO_CONN` | Yes | MongoDB connection string — startup fails without it |
| `MONGO_DB_NAME` | No | Database name (defaults to `auth-db`) |
| `ML_OPERATIONS_TOKEN` | No | Shared secret for the three operational endpoints; unset means those endpoints fail closed |
| `ML_MODEL_ROOT` | No | Root directory for model bundles (default `./training/models`) |
| `ML_RETRAIN_STALE_TIMEOUT_SECONDS` | No | Retraining lock staleness threshold |
| `ML_ORPHANED_RUN_THRESHOLD_SECONDS` | No | Threshold for reconciling an orphaned run at startup |
| `ML_MANIFEST_CHECK_INTERVAL_SECONDS` | No | How often a worker checks for a newly activated model (default 5s) |
| `ML_MAX_ACCURACY_REGRESSION` | No | Maximum allowed accuracy drop before validation gate 7 fails |
| `ML_FEEDBACK_DUPLICATE_CAP` | No | Cap on near-duplicate feedback entries per training run (default 3) |
| `ML_MODEL_RETENTION_COUNT` / `ML_REJECTED_MODEL_RETENTION_COUNT` / `ML_MODEL_RETENTION_DAYS` | No | Cleanup/retention tuning for old model bundles |

No secret values are included here or anywhere in this repository's tracked files.

## Installation and run/test commands

```bash
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

uvicorn app:app --host 0.0.0.0 --port 8000 --workers <N>   # production-style
uvicorn app:app --reload                                   # local dev, auto-reload
```

Tests live under `tests/`; `requirements-test.txt` lists the additional test
dependencies. Integration tests require `ML_TEST_MONGO_CONN`/`ML_TEST_MONGO_DB_NAME`
pointed at an isolated database whose name must contain `test` — the suite refuses to
run otherwise, so it cannot touch production data.

## Current limitations

- No authentication on the prediction, description-generation, or retraining endpoints
  themselves — only the operational/status endpoints are gated.
- Internal prediction failures return HTTP `200` with an `{"error": ...}` body rather
  than a non-2xx status, so a caller that only checks the status code will treat a
  failure as a success.
- A newly activated model reaches other workers only after a lazy, throttled check — not
  immediately.
- Retraining acceptance is asynchronous; there is no endpoint to block until a run
  finishes.
- One shared global model — a correction from one user can measurably shift predictions
  for every other user.
- A hard process kill during retraining loses the background thread silently; it is only
  recovered at the next process restart, via the startup reconciliation sweeps.

## Relationship to SIA

**SIA does not run in this service.** There is no SIA code, endpoint, model, prompt, or
LLM dependency anywhere in `ml-service/` — this service's only model is the TF-IDF +
Random Forest category classifier described above.

SIA is implemented entirely in the Express backend (see the
[backend README](../backend/README.md#sia-v1)), where it explains the deterministic
**Report** produced by the backend's own analytics engine. It never calls this service,
and this service never calls it. The two are independent: disabling SIA changes nothing
here, and this service being down does not affect SIA.

Prediction confidence produced here is a classifier probability for a category
suggestion. It is unrelated to SIA's answers and is not used to ground them.

## Implemented versus planned

| Capability | Status |
|---|---|
| Category prediction (TF-IDF + Random Forest) with confidence | Implemented |
| Rule-based description generation | Implemented (template/keyword matching, not ML) |
| Feedback-driven full retraining with 9-gate validation | Implemented |
| Atomic, versioned model bundle persistence and activation | Implemented |
| Startup reconciliation for interrupted runs | Implemented |
| Token-gated operational/status endpoints (fail closed) | Implemented |
| Forecasting | Planned — no forecasting model, endpoint, or pipeline exists |
| Financial-risk prediction | Planned — not present in any model or route |
| Anomaly detection | Planned — not present in any model or route |
| Per-user or per-account model personalization | Planned |
| Online/incremental learning rather than full refits | Planned |
| Service-to-service authentication for backend→ML calls | Planned |
| Any LLM, SIA, or generative capability in this service | Not implemented, and out of scope by design |
