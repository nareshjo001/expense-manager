# ML Service module — workflow documentation

Ten confirmed HTTP endpoints under the FastAPI `ml-service/`, each documented as its own API
workflow — no real endpoint is folded into a combined document, including the three health
endpoints and the two operational status endpoints with no confirmed caller. Plus one more
API workflow, **ML-API-11**, added during the repository-wide API coverage gate: the
Express backend's own `POST /ml/predict-category` proxy route, previously described only
inside ML-FLOW-09 (not a substitute for its own document under this corpus's coverage
rules — a combined flow cannot stand in for a single endpoint's API document). Nine
internal/combined flows explain the parts of the system with no endpoint of their own:
prediction, startup model loading, dataset construction, training/evaluation, validation,
persistence/activation, the retraining lifecycle as a whole, startup reconciliation, and the
backend↔ML categorization integration. Discovered by reading `ml-service/app.py` outward —
nothing here was assumed from the audit prompt's suggested names before being confirmed in the
repository.

Diagrams reuse the approved BALENISA design system in
[`../diagram-tokens.json`](../diagram-tokens.json) and
[`../workflow_diagram.py`](../workflow_diagram.py). No new shared components were required —
every region, card style, and exception-band pattern already existed.

## Module purpose

Everything in this module either predicts an expense category from text, generates a filler
description, or retrains the one shared classification model from accumulated user
corrections. There is no per-user model, no online learning, and no scheduler internal to this
service — retraining is triggered by a daily cron job in the Node backend, or manually.

## Confirmed APIs

| ID | Method | Endpoint | Status | Document |
|---|---|---|---|---|
| ML-API-01 | HEAD | `/` | Externally reachable but unused | [ml-api-01-health-head.md](ml-api-01-health-head.md) |
| ML-API-02 | GET | `/` | Actively used (backend `/ping`) | [ml-api-02-health.md](ml-api-02-health.md) |
| ML-API-03 | GET | `/health/live` | Externally reachable but unused | [ml-api-03-health-live.md](ml-api-03-health-live.md) |
| ML-API-04 | GET | `/health/ready` | Externally reachable but unused | [ml-api-04-health-ready.md](ml-api-04-health-ready.md) |
| ML-API-05 | GET | `/ml-status` | Internal/testing endpoint | [ml-api-05-ml-status.md](ml-api-05-ml-status.md) |
| ML-API-06 | GET | `/training-runs` | Internal/testing endpoint | [ml-api-06-training-runs-list.md](ml-api-06-training-runs-list.md) |
| ML-API-07 | GET | `/training-runs/{run_id}` | Internal/testing endpoint | [ml-api-07-training-run-detail.md](ml-api-07-training-run-detail.md) |
| ML-API-08 | POST | `/predict-category` | Actively used | [ml-api-08-predict-category.md](ml-api-08-predict-category.md) |
| ML-API-09 | POST | `/generate-description` | Actively used | [ml-api-09-generate-description.md](ml-api-09-generate-description.md) |
| ML-API-10 | POST | `/retrain-model` | Actively used (daily cron) | [ml-api-10-retrain-model.md](ml-api-10-retrain-model.md) |

That is the complete FastAPI surface — confirmed by reading every `@app.get/post/head` decorator
in `app.py`. Full inventory with caller evidence:
[ml-service-consumption-map.md, Table A](ml-service-consumption-map.md#a-http-api-inventory).

### Backend proxy route (Express, not FastAPI)

| ID | Method | Endpoint | Status | Document |
|---|---|---|---|---|
| ML-API-11 | POST | `/ml/predict-category` (Express, `backend/Routes/ml.router.js`) | Actively used | [ml-api-11-backend-predict-proxy.md](ml-api-11-backend-predict-proxy.md) |

This is a distinct route from ML-API-08 — a different server, a different path, and this
module's only API document that lives in the Express backend rather than the FastAPI
service. It is documented here because this module already owns the FastAPI side of the
same prediction round trip; ML-FLOW-09 continues to describe the combined round trip but
is not this route's coverage.

## Internal / combined flows

| ID | Type | Document |
|---|---|---|
| ML-FLOW-01 | Internal (in-memory pipeline) | [ml-flow-01-prediction-pipeline.md](ml-flow-01-prediction-pipeline.md) |
| ML-FLOW-02 | Internal (FastAPI startup) | [ml-flow-02-startup-loading.md](ml-flow-02-startup-loading.md) |
| ML-FLOW-03 | Internal (retraining stage) | [ml-flow-03-dataset-construction.md](ml-flow-03-dataset-construction.md) |
| ML-FLOW-04 | Internal (retraining stage, subprocess) | [ml-flow-04-training-evaluation.md](ml-flow-04-training-evaluation.md) |
| ML-FLOW-05 | Internal (retraining stage, subprocess) | [ml-flow-05-validation-promotion.md](ml-flow-05-validation-promotion.md) |
| ML-FLOW-06 | Internal (retraining stage) | [ml-flow-06-persistence-activation.md](ml-flow-06-persistence-activation.md) |
| ML-FLOW-07 | Internal (umbrella lifecycle) | [ml-flow-07-retraining-lifecycle.md](ml-flow-07-retraining-lifecycle.md) |
| ML-FLOW-08 | Internal (FastAPI startup) | [ml-flow-08-startup-reconciliation.md](ml-flow-08-startup-reconciliation.md) |
| ML-FLOW-09 | Combined (Node backend + FastAPI) | [ml-flow-09-backend-integration.md](ml-flow-09-backend-integration.md) |

ML-FLOW-07 is the explicitly-permitted umbrella lifecycle connecting ML-FLOW-03 through
ML-FLOW-06 — it does not replace their independent, stage-level documentation.

## Prediction lifecycle

One process-wide `RuntimeSnapshot` (model + vectorizer + label encoder), acquired at startup
(ML-FLOW-02) and refreshed lazily per-process on a throttled manifest-generation check inside
ML-FLOW-01 itself. `POST /predict-category` (ML-API-08) is the only endpoint that reaches this
pipeline; `POST /generate-description` (ML-API-09) is unrelated rule-based text, not a model.

## Training/retraining lifecycle

Manual or cron-triggered via `POST /retrain-model` (ML-API-10) → a MongoDB-backed distributed
lock → a background thread (ML-FLOW-07) sequencing dataset construction (ML-FLOW-03), training
(ML-FLOW-04), validation (ML-FLOW-05), and activation (ML-FLOW-06) → six possible terminal
states. Full state-transition table: [ML-FLOW-07](ml-flow-07-retraining-lifecycle.md#8-state-transitions).

## Model-bundle lifecycle

`training/model_bundle.py` owns the on-disk layout: `training/models/model-<runId>/` (three
joblib artifacts + `metadata.json`, atomic temp-dir-then-rename) and `training/models/active.json`
(the published pointer, atomic temp-file-then-`os.replace`). Retention/cleanup is best-effort and
runs only after activation and feedback are already terminal — see
[ml-service-consumption-map.md, Table D](ml-service-consumption-map.md#d-dataartifact-inventory).

## Persistence model

Two MongoDB collections owned by this service (`mltrainingruns`, `mltraininglocks`), one shared
with the Node backend (`mlfeedbacks`, defined in `backend/config/Schemas.js`). Full repository
inventory: [ml-service-consumption-map.md, Table E](ml-service-consumption-map.md#e-repositorycollection-inventory).

## Runtime state

Every FastAPI worker/replica holds its own independent `RuntimeSnapshot` — there is no shared
in-process memory across workers. Convergence after an activation is lazy and per-process, via
ML-FLOW-01's own throttled check, never immediate and never centrally pushed.

## Backend integration

Four confirmed backend→ML calls, all via plain `axios`, **none carrying any authentication
header or token**: `POST /predict-category` (5s timeout), `POST /generate-description` (5s
timeout), `POST /retrain-model` (no timeout set), and `GET /` (health, no timeout visible).
Full trace: [ML-FLOW-09](ml-flow-09-backend-integration.md).

## Security boundary

The three operational endpoints (`/ml-status`, `/training-runs`, `/training-runs/{id}`) are
gated by a shared-secret `X-ML-Operations-Token` header, fail-closed if unset — and **is
unset** in this repository's checked-out `.env`, making all three unconditionally 503 in the
current configuration. Every other endpoint (health checks, predict, generate-description,
retrain-model) has **no authentication of its own** — the only real access control a real user
request passes through is the backend's `verifyToken` middleware on `/ml/predict-category`,
documented in the Authentication module.

## Documents and diagrams

| Workflow | Level 1 | Level 2 | Document |
|---|---|---|---|
| ML-API-01 | [overview](ml-api-01-health-head-overview.svg) | [detailed](ml-api-01-health-head-detailed.svg) | [ml-api-01-health-head.md](ml-api-01-health-head.md) |
| ML-API-02 | [overview](ml-api-02-health-overview.svg) | [detailed](ml-api-02-health-detailed.svg) | [ml-api-02-health.md](ml-api-02-health.md) |
| ML-API-03 | [overview](ml-api-03-health-live-overview.svg) | [detailed](ml-api-03-health-live-detailed.svg) | [ml-api-03-health-live.md](ml-api-03-health-live.md) |
| ML-API-04 | [overview](ml-api-04-health-ready-overview.svg) | [detailed](ml-api-04-health-ready-detailed.svg) | [ml-api-04-health-ready.md](ml-api-04-health-ready.md) |
| ML-API-05 | [overview](ml-api-05-ml-status-overview.svg) | [detailed](ml-api-05-ml-status-detailed.svg) | [ml-api-05-ml-status.md](ml-api-05-ml-status.md) |
| ML-API-06 | [overview](ml-api-06-training-runs-list-overview.svg) | [detailed](ml-api-06-training-runs-list-detailed.svg) | [ml-api-06-training-runs-list.md](ml-api-06-training-runs-list.md) |
| ML-API-07 | [overview](ml-api-07-training-run-detail-overview.svg) | [detailed](ml-api-07-training-run-detail-detailed.svg) | [ml-api-07-training-run-detail.md](ml-api-07-training-run-detail.md) |
| ML-API-08 | [overview](ml-api-08-predict-category-overview.svg) | [detailed](ml-api-08-predict-category-detailed.svg) | [ml-api-08-predict-category.md](ml-api-08-predict-category.md) |
| ML-API-09 | [overview](ml-api-09-generate-description-overview.svg) | [detailed](ml-api-09-generate-description-detailed.svg) | [ml-api-09-generate-description.md](ml-api-09-generate-description.md) |
| ML-API-10 | [overview](ml-api-10-retrain-model-overview.svg) | [detailed](ml-api-10-retrain-model-detailed.svg) | [ml-api-10-retrain-model.md](ml-api-10-retrain-model.md) |
| ML-API-11 | [overview](ml-api-11-backend-predict-proxy-overview.svg) | [detailed](ml-api-11-backend-predict-proxy-detailed.svg) | [ml-api-11-backend-predict-proxy.md](ml-api-11-backend-predict-proxy.md) |
| ML-FLOW-01 | [overview](ml-flow-01-prediction-pipeline-overview.svg) | [detailed](ml-flow-01-prediction-pipeline-detailed.svg) | [ml-flow-01-prediction-pipeline.md](ml-flow-01-prediction-pipeline.md) |
| ML-FLOW-02 | [overview](ml-flow-02-startup-loading-overview.svg) | [detailed](ml-flow-02-startup-loading-detailed.svg) | [ml-flow-02-startup-loading.md](ml-flow-02-startup-loading.md) |
| ML-FLOW-03 | [overview](ml-flow-03-dataset-construction-overview.svg) | [detailed](ml-flow-03-dataset-construction-detailed.svg) | [ml-flow-03-dataset-construction.md](ml-flow-03-dataset-construction.md) |
| ML-FLOW-04 | [overview](ml-flow-04-training-evaluation-overview.svg) | [detailed](ml-flow-04-training-evaluation-detailed.svg) | [ml-flow-04-training-evaluation.md](ml-flow-04-training-evaluation.md) |
| ML-FLOW-05 | [overview](ml-flow-05-validation-promotion-overview.svg) | [detailed](ml-flow-05-validation-promotion-detailed.svg) | [ml-flow-05-validation-promotion.md](ml-flow-05-validation-promotion.md) |
| ML-FLOW-06 | [overview](ml-flow-06-persistence-activation-overview.svg) | [detailed](ml-flow-06-persistence-activation-detailed.svg) | [ml-flow-06-persistence-activation.md](ml-flow-06-persistence-activation.md) |
| ML-FLOW-07 | [overview](ml-flow-07-retraining-lifecycle-overview.svg) | [detailed](ml-flow-07-retraining-lifecycle-detailed.svg) | [ml-flow-07-retraining-lifecycle.md](ml-flow-07-retraining-lifecycle.md) |
| ML-FLOW-08 | [overview](ml-flow-08-startup-reconciliation-overview.svg) | [detailed](ml-flow-08-startup-reconciliation-detailed.svg) | [ml-flow-08-startup-reconciliation.md](ml-flow-08-startup-reconciliation.md) |
| ML-FLOW-09 | [overview](ml-flow-09-backend-integration-overview.svg) | [detailed](ml-flow-09-backend-integration-detailed.svg) | [ml-flow-09-backend-integration.md](ml-flow-09-backend-integration.md) |

Full inventory tables (HTTP API, components, backend/frontend integration, data/artifact,
repository/collection, environment variables, dead/unused code, findings):
[ml-service-consumption-map.md](ml-service-consumption-map.md). End-to-end state machine and
lifecycle narrative: [ml-service-lifecycle.md](ml-service-lifecycle.md).

## Confirmed limitations

The ten worth reading first (full list per-document):

1. **No service-to-service authentication** on any of the four backend→ML calls, or on
   `/predict-category`, `/generate-description`, `/retrain-model` themselves.
2. **The three operational status endpoints are unconditionally 503** in this repository's
   checked-out `.env` — `ML_OPERATIONS_TOKEN` is never set.
3. **Regression-threshold default mismatch** — `.env.example` documents `0.02`; the code's own
   fallback (`validate_model.py`) is actually `0.05` when the env var is unset, which is what
   currently governs validation gate 7.
4. **`generate-description`'s failure-fallback log message disagrees with its actual behaviour**
   — logs "falling back to \"Others\"" but writes an empty string.
5. **A feedback-write failure blocks expense creation, unlike a description-generation
   failure.** `addexpense.js` gives `POST /generate-description` its own `try/catch` so it can
   never block the save; `mlFeedback.save()` has no equivalent isolation — a validation or
   database error there returns `500` and the expense is never persisted.
6. **Feedback and expense persistence are two sequential, non-transactional writes** — no
   MongoDB session wraps `mlFeedback.save()` and `newExpense.save()` in `addexpense.js`.
7. **Corrections only train the model when made at expense-creation time** — confirmed absent
   from both `editExpense.js` and `geteditexpense.js`; editing a category after the fact never
   produces a training-feedback document.
8. **All users' data trains one shared global model** — a correction from one user can measurably
   shift predictions for every other user.
9. **Retraining acceptance (`202`/`200` from `POST /retrain-model`) is not completion.** The
   daily cron only fires past 100 pending corrections at 20:30 server time, and the response
   only means the run was accepted or is already active — never that training, validation, or
   activation has finished.
10. **A hard process kill during retraining loses the background thread silently** — recovered
    only at the next process restart, via ML-FLOW-08.

## Out-of-scope functionality

Confirmed **absent** from this repository, not merely undocumented:

- Per-user or per-account models.
- Online/incremental learning — every retrain is a full refit from scratch.
- A scheduler internal to the ML service — retraining is cron-in-the-Node-backend or manual only.
- Service-to-service authentication between the backend and the ML service.
- **SIA (a Spending/Smart Insights Assistant)** — not implemented anywhere this audit traced,
  consistent with the Report module's own confirmed "no ML/SIA dependency" finding. Remains
  planned/out of scope; not documented as if it existed.
- A message queue, model registry, or experiment-tracking integration of any kind.
- Model rollback via an API (the manifest *can* be rolled back automatically on an activation
  failure — see ML-FLOW-06 — but no endpoint lets an operator manually revert to a prior version).
- GPU/accelerated inference — plain scikit-learn, CPU-only.

## Regenerating

```bash
cd docs/api-workflows/ml-service
python3 build_ml_overviews.py
python3 build_ml_detailed.py
python3 build_ml_api11_overview.py    # ML-API-11 only — added by the coverage gate
python3 build_ml_api11_detailed.py
```

All scripts are cwd-independent (verified by running from `/tmp`) and were rasterized with the
same `librsvg`/`cairo` bridge used for every other module in this corpus. ML-API-11 was kept
in its own scripts rather than appended to `build_ml_overviews.py`/`build_ml_detailed.py`, so
the original 19-workflow ML Service set stays byte-identical on regeneration.
