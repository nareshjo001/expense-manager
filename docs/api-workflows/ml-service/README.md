# ML Service module — workflow documentation

Eleven confirmed HTTP endpoints under the FastAPI `ml-service/`, each documented as its own API
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
| ML-API-01 | HEAD | `/` | Externally reachable but unused | [document](health-head/ml-api-01-health-head.md) |
| ML-API-02 | GET | `/` | Actively used (backend `/ping`) | [document](health/ml-api-02-health.md) |
| ML-API-03 | GET | `/health/live` | Externally reachable but unused | [document](health-live/ml-api-03-health-live.md) |
| ML-API-04 | GET | `/health/ready` | Externally reachable but unused | [document](health-ready/ml-api-04-health-ready.md) |
| ML-API-05 | GET | `/ml-status` | Internal/testing endpoint | [document](ml-status/ml-api-05-ml-status.md) |
| ML-API-06 | GET | `/training-runs` | Internal/testing endpoint | [document](training-runs-list/ml-api-06-training-runs-list.md) |
| ML-API-07 | GET | `/training-runs/{run_id}` | Internal/testing endpoint | [document](training-run/ml-api-07-training-run-detail.md) |
| ML-API-08 | POST | `/predict-category` | Actively used | [document](predict-category/ml-api-08-predict-category.md) |
| ML-API-09 | POST | `/generate-description` | Actively used | [document](generate-description/ml-api-09-generate-description.md) |
| ML-API-10 | POST | `/retrain-model` | Actively used (daily cron) | [document](retrain-model/ml-api-10-retrain-model.md) |
| ML-API-12 | POST | `/predict-spending-forecast` | Backend proxy target | [document](spending-forecast/ml-api-12-spending-forecast.md) |

That is the complete FastAPI surface — confirmed by reading every `@app.get/post/head` decorator
in `app.py`. Full inventory with caller evidence:
the endpoint documents and their verified caller traces below.

### Backend proxy route (Express, not FastAPI)

| ID | Method | Endpoint | Status | Document |
|---|---|---|---|---|
| ML-API-11 | POST | `/ml/predict-category` (Express, `backend/Routes/ml.router.js`) | Actively used | [document](backend-predict-proxy/ml-api-11-backend-predict-proxy.md) |
| ML-API-12 | POST | `/ml/predict-spending-forecast` (Express, `backend/Routes/ml.router.js`) | JWT-protected proxy | [document](spending-forecast/ml-api-12-spending-forecast.md) |

This is a distinct route from ML-API-08 — a different server, a different path, and this
module's only API document that lives in the Express backend rather than the FastAPI
service. It is documented here because this module already owns the FastAPI side of the
same prediction round trip; ML-FLOW-09 continues to describe the combined round trip but
is not this route's coverage.

## Internal / combined flows

| ID | Type | Document |
|---|---|---|
| ML-FLOW-01 | Internal (in-memory pipeline) | [document](flow/prediction/ml-flow-01-prediction-pipeline.md) |
| ML-FLOW-02 | Internal (FastAPI startup) | [document](flow/startup-loading/ml-flow-02-startup-loading.md) |
| ML-FLOW-03 | Internal (retraining stage) | [document](flow/dataset-const/ml-flow-03-dataset-construction.md) |
| ML-FLOW-04 | Internal (retraining stage, subprocess) | [document](flow/training-eval/ml-flow-04-training-evaluation.md) |
| ML-FLOW-05 | Internal (retraining stage, subprocess) | [document](flow/validation-promotion/ml-flow-05-validation-promotion.md) |
| ML-FLOW-06 | Internal (retraining stage) | [document](flow/persistence-activation/ml-flow-06-persistence-activation.md) |
| ML-FLOW-07 | Internal (umbrella lifecycle) | [document](flow/retraining-lifecycle/ml-flow-07-retraining-lifecycle.md) |
| ML-FLOW-08 | Internal (FastAPI startup) | [document](startup-reconciliation/ml-flow-08-startup-reconciliation.md) |
| ML-FLOW-09 | Combined (Node backend + FastAPI) | [document](flow/backend-integration/ml-flow-09-backend-integration.md) |

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
states. Full state-transition table: [ML-FLOW-07](flow/retraining-lifecycle/ml-flow-07-retraining-lifecycle.md#8-state-transitions).

## Model-bundle lifecycle

`training/model_bundle.py` owns the on-disk layout: `training/models/model-<runId>/` (three
joblib artifacts + `metadata.json`, atomic temp-dir-then-rename) and `training/models/active.json`
(the published pointer, atomic temp-file-then-`os.replace`). Retention/cleanup is best-effort and
runs only after activation and feedback are already terminal — see
ml-service-consumption-map.md, Table D.

## Persistence model

Two MongoDB collections owned by this service (`mltrainingruns`, `mltraininglocks`), one shared
with the Node backend (`mlfeedbacks`, defined in `backend/config/Schemas.js`). Full repository
inventory: ml-service-consumption-map.md, Table E.

## Runtime state

Every FastAPI worker/replica holds its own independent `RuntimeSnapshot` — there is no shared
in-process memory across workers. Convergence after an activation is lazy and per-process, via
ML-FLOW-01's own throttled check, never immediate and never centrally pushed.

## Backend integration

The backend sends `X-ML-Operations-Token` on its protected ML calls: `POST /predict-category`
(5s timeout), `POST /generate-description` (5s timeout), `POST /retrain-model` (no timeout
set), and spending-forecast requests (3s default timeout). `GET /` from `/ping` is an
unauthenticated health probe. Full trace: [ML-FLOW-09](flow/backend-integration/ml-flow-09-backend-integration.md).

## Security boundary

`/ml-status`, `/training-runs`, `/training-runs/{id}`, `/predict-category`,
`/generate-description`, `/predict-spending-forecast`, and `/retrain-model` require the shared
`X-ML-Operations-Token` header and fail closed with `503` when `ML_OPERATIONS_TOKEN` is not
configured. Health endpoints remain deliberately unauthenticated probes. The Express
`/ml/predict-category` proxy additionally requires the user JWT via `verifyToken`.

## Documents and diagrams

| Workflow | Level 1 | Level 2 | Document |
|---|---|---|---|
| ML-API-01 | [overview](health-head/ml-api-01-health-head-overview.svg) | [detailed](health-head/ml-api-01-health-head-detailed.svg) | [document](health-head/ml-api-01-health-head.md) |
| ML-API-02 | [overview](health/ml-api-02-health-overview.svg) | [detailed](health/ml-api-02-health-detailed.svg) | [document](health/ml-api-02-health.md) |
| ML-API-03 | [overview](health-live/ml-api-03-health-live-overview.svg) | [detailed](health-live/ml-api-03-health-live-detailed.svg) | [document](health-live/ml-api-03-health-live.md) |
| ML-API-04 | [overview](health-ready/ml-api-04-health-ready-overview.svg) | [detailed](health-ready/ml-api-04-health-ready-detailed.svg) | [document](health-ready/ml-api-04-health-ready.md) |
| ML-API-05 | [overview](ml-status/ml-api-05-ml-status-overview.svg) | [detailed](ml-status/ml-api-05-ml-status-detailed.svg) | [document](ml-status/ml-api-05-ml-status.md) |
| ML-API-06 | [overview](training-runs-list/ml-api-06-training-runs-list-overview.svg) | [detailed](training-runs-list/ml-api-06-training-runs-list-detailed.svg) | [document](training-runs-list/ml-api-06-training-runs-list.md) |
| ML-API-07 | [overview](training-run/ml-api-07-training-run-detail-overview.svg) | [detailed](training-run/ml-api-07-training-run-detail-detailed.svg) | [document](training-run/ml-api-07-training-run-detail.md) |
| ML-API-08 | [overview](predict-category/ml-api-08-predict-category-overview.svg) | [detailed](predict-category/ml-api-08-predict-category-detailed.svg) | [document](predict-category/ml-api-08-predict-category.md) |
| ML-API-09 | [overview](generate-description/ml-api-09-generate-description-overview.svg) | [detailed](generate-description/ml-api-09-generate-description-detailed.svg) | [document](generate-description/ml-api-09-generate-description.md) |
| ML-API-10 | [overview](retrain-model/ml-api-10-retrain-model-overview.svg) | [detailed](retrain-model/ml-api-10-retrain-model-detailed.svg) | [document](retrain-model/ml-api-10-retrain-model.md) |
| ML-API-11 | [overview](backend-predict-proxy/ml-api-11-backend-predict-proxy-overview.svg) | [detailed](backend-predict-proxy/ml-api-11-backend-predict-proxy-detailed.svg) | [document](backend-predict-proxy/ml-api-11-backend-predict-proxy.md) |
| ML-API-12 | [overview](spending-forecast/ml-api-12-spending-forecast-overview.svg) | [detailed](spending-forecast/ml-api-12-spending-forecast-detailed.svg) | [document](spending-forecast/ml-api-12-spending-forecast.md) |
| ML-FLOW-01 | [overview](flow/prediction/ml-flow-01-prediction-pipeline-overview.svg) | [detailed](flow/prediction/ml-flow-01-prediction-pipeline-detailed.svg) | [document](flow/prediction/ml-flow-01-prediction-pipeline.md) |
| ML-FLOW-02 | [overview](flow/startup-loading/ml-flow-02-startup-loading-overview.svg) | [detailed](flow/startup-loading/ml-flow-02-startup-loading-detailed.svg) | [document](flow/startup-loading/ml-flow-02-startup-loading.md) |
| ML-FLOW-03 | [overview](flow/dataset-const/ml-flow-03-dataset-construction-overview.svg) | [detailed](flow/dataset-const/ml-flow-03-dataset-construction-detailed.svg) | [document](flow/dataset-const/ml-flow-03-dataset-construction.md) |
| ML-FLOW-04 | [overview](flow/training-eval/ml-flow-04-training-evaluation-overview.svg) | [detailed](flow/training-eval/ml-flow-04-training-evaluation-detailed.svg) | [document](flow/training-eval/ml-flow-04-training-evaluation.md) |
| ML-FLOW-05 | [overview](flow/validation-promotion/ml-flow-05-validation-promotion-overview.svg) | [detailed](flow/validation-promotion/ml-flow-05-validation-promotion-detailed.svg) | [document](flow/validation-promotion/ml-flow-05-validation-promotion.md) |
| ML-FLOW-06 | [overview](flow/persistence-activation/ml-flow-06-persistence-activation-overview.svg) | [detailed](flow/persistence-activation/ml-flow-06-persistence-activation-detailed.svg) | [document](flow/persistence-activation/ml-flow-06-persistence-activation.md) |
| ML-FLOW-07 | [overview](flow/retraining-lifecycle/ml-flow-07-retraining-lifecycle-overview.svg) | [detailed](flow/retraining-lifecycle/ml-flow-07-retraining-lifecycle-detailed.svg) | [document](flow/retraining-lifecycle/ml-flow-07-retraining-lifecycle.md) |
| ML-FLOW-08 | [overview](startup-reconciliation/ml-flow-08-startup-reconciliation-overview.svg) | [detailed](startup-reconciliation/ml-flow-08-startup-reconciliation-detailed.svg) | [document](startup-reconciliation/ml-flow-08-startup-reconciliation.md) |
| ML-FLOW-09 | [overview](flow/backend-integration/ml-flow-09-backend-integration-overview.svg) | [detailed](flow/backend-integration/ml-flow-09-backend-integration-detailed.svg) | [document](flow/backend-integration/ml-flow-09-backend-integration.md) |

End-to-end state machine and lifecycle narrative:
[ml-service-lifecycle.md](ml-service-lifecycle.md).

## Confirmed limitations

The ten worth reading first (full list per-document):

1. **Protected ML calls depend on matching `ML_OPERATIONS_TOKEN` configuration** in the backend
   and ML service. A missing configuration fails closed with `503`; a missing or wrong header is
   rejected with `401`.
2. **The checked-in `.env` is not a deployment configuration.** Runtime token availability must
   be verified in the deployed environment; no token value is documented or logged here.
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
