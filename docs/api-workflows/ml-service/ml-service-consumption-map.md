# ML Service — consumption map

Full inventory tables supporting [README.md](README.md). Every row traced directly to source; no
row is present because the audit prompt suggested it — each was confirmed by reading the file
cited.

## A. HTTP API inventory

| ML API ID | Method | Endpoint | Route mount | Request schema | Handler | Authentication | Caller | Status |
|---|---|---|---|---|---|---|---|---|
| ML-API-01 | HEAD | `/` | `app.py:413` | None | `health_head()` | None | Not found | Externally reachable but unused |
| ML-API-02 | GET | `/` | `app.py:418` | None | `health()` | None | `backend/server.js:63` (`/ping`) | Actively used |
| ML-API-03 | GET | `/health/live` | `app.py:446` | None | `health_live()` | None | Not found (tests only) | Externally reachable but unused |
| ML-API-04 | GET | `/health/ready` | `app.py:456` | None | `health_ready()` | None | Not found (tests only) | Externally reachable but unused |
| ML-API-05 | GET | `/ml-status` | `app.py:471` | Header only | `ml_status()` | `X-ML-Operations-Token`, fail-closed | Not found; token unset in `.env` | Internal/testing endpoint |
| ML-API-06 | GET | `/training-runs` | `app.py:498` | Query params + header | `training_run_list()` | Same as ML-API-05 | Not found | Internal/testing endpoint |
| ML-API-07 | GET | `/training-runs/{run_id}` | `app.py:482` | Path param + header | `training_run_detail()` | Same as ML-API-05 | Not found | Internal/testing endpoint |
| ML-API-08 | POST | `/predict-category` | `app.py:519` | `PredictionRequest` | `predict()` | None | `backend/Routes/ml.router.js` | Actively used |
| ML-API-09 | POST | `/generate-description` | `app.py:527` | `DescriptionRequest` | `generate_description_api()` | None | `backend/Controllers/ExpenseControllers/addexpense.js` | Actively used |
| ML-API-10 | POST | `/retrain-model` | `app.py:1089` | `RetrainTriggerRequest` (optional) | `retrain_model()` | None | `backend/cron/feedbackCollector.js` | Actively used |

## B. Component inventory

| Component ID | File | Class/function/export | Inputs | Outputs | Called by | Side effects |
|---|---|---|---|---|---|---|
| C-01 | `inference/predictor.py` | `predict_category()` | expense name string | prediction dict | ML-API-08 | None (pure) |
| C-02 | `inference/predictor.py` | `preprocess_text()` | raw string | cleaned string | C-01 | None (pure) |
| C-03 | `inference/predictor_manager.py` | `PredictorManager` | manifest, bundle files | `RuntimeSnapshot` | app startup, C-01, ML-FLOW-06 | In-memory state mutation |
| C-04 | `inference/descriptionGenerator.py` | `generate_description_response()` | name, category, amount | description string | ML-API-09 | None (pure, `random.choice`) |
| C-05 | `training/dataset_builder.py` | `reserve_feedback_for_run()`, `build_snapshot_for_run()` | run id, feedback docs | dataset CSV + metadata | ML-FLOW-07 | MongoDB writes, filesystem write |
| C-06 | `training/trainer.py` | module script | dataset path | bundle + result file | ML-FLOW-04 (subprocess) | Filesystem write |
| C-07 | `training/model_validation.py` | `run_all_gates()` + 9 gates | bundle, baseline | gate results | ML-FLOW-05 (subprocess) | None (read-only) |
| C-08 | `training/model_bundle.py` | `write_bundle()`, `write_manifest()`, `load_bundle()`, `read_manifest()` | model objects, manifest dict | bundle dir, manifest file | C-06, ML-FLOW-06, C-03 | Atomic filesystem writes |
| C-09 | `training/retrain_pipeline.py` | `run_retraining()` | run id, baseline | structured result dict | ML-FLOW-07 | Subprocess launches |
| C-10 | `training/model_cleanup.py` | `run_cleanup()` | run/status lookups | deletion plan + execution | ML-FLOW-07 (post-activation) | Filesystem deletion |
| C-11 | `training/category_config.py` | `CATEGORY_ALIASES`, `normalize_category()` | raw category string | canonical string or None | C-05, C-06, C-07 | None (pure) |
| C-12 | `db/training_run_repository.py` | `create_run()`, `mark_*()`, `claim_or_reclaim()`, etc. | run id, status data | MongoDB writes/reads | app.py, C-05, C-09 | MongoDB mutation |
| C-13 | `db/feedback_repository.py` | `reserve_pending_feedback()`, `finalize_trained_for_run()`, etc. | run id | MongoDB writes/reads | C-05, ML-FLOW-06 | MongoDB mutation |
| C-14 | `db/mongo.py` | `get_client()`, `get_db()` | env `MONGO_CONN` | MongoClient/DB handle | C-12, C-13 | Lazy connection creation |
| C-15 | `status_api.py` | `build_ml_status()`, `build_readiness()`, `serialize_run_*()` | predictor state, manifest, run docs | sanitized dicts | ML-API-04/05/06/07 | None (read-only) |
| C-16 | `observability.py` | `log_event()`, `sanitize_reason()` | event name, fields | log line | Used throughout app.py, predictor_manager.py, model_cleanup.py | Logging only |
| C-17 | `config.py` | `run_and_log_startup_validation()` | environment variables | errors/warnings summary | app startup | None (read-only + logging) |
| C-18 | `app.py` | `background_retrain()`, `_attempt_activation()`, 4 startup handlers | run id | run status transitions | ML-API-10, FastAPI lifespan | MongoDB + filesystem + in-memory |

Classification: C-01/C-02/C-04/C-07/C-11/C-15 = pure transformation; C-03/C-18(activation part) =
model inference / runtime state; C-06/C-09 = training orchestration; C-08/C-10 = artifact
persistence; C-12/C-13/C-14 = database state; C-16/C-17 = HTTP-layer-adjacent (logging/config,
not routing itself).

## C. Backend/frontend integration inventory

| Integration ID | Backend trigger | Backend file/function | ML request | Data sent | ML response used | Fallback/error behaviour |
|---|---|---|---|---|---|---|
| I-01 | `POST /ml/predict-category` (frontend-triggered) — its own document, **[ML-API-11](ml-api-11-backend-predict-proxy.md)** | `backend/Routes/ml.router.js` | `POST /predict-category` | `{expenseName}` | Forwarded verbatim as the backend's own 200 body | No response → 503; ML 4xx → forwarded; else → 500 |
| I-02 | Expense creation, blank description | `backend/Controllers/ExpenseControllers/addexpense.js` | `POST /generate-description` | `{expenseName, expenseCategory, expenseAmount}` | Written into `expenseDescription` before save | Caught locally, `finalDescription = ""`, save proceeds |
| I-03 | Daily cron, `>= 100` pending feedback | `backend/cron/feedbackCollector.js` | `POST /retrain-model` | None | Logged only (`existingRun` vs. new) | 503 logged as expected/transient, retried next scheduled run |
| I-04 | Backend's own `/ping` route | `backend/server.js:63` | `GET /` | None | `ml: "up"`/`"down"` in `/ping`'s own response | Any error/timeout → `"down"` |

These are the complete four backend→ML calls, confirmed by a repo-wide search for `ML_ROUTE`
and every documented ML endpoint path across `backend/`. **Frontend never calls the ML service
directly** — confirmed by a repo-wide search of `frontend/src` for the ML service's base URL,
port, and endpoint names; the only match is the frontend's own call to the *backend's*
`/ml/predict-category` proxy (`AddExpense.js`, pre-submission, debounced 500ms).

**Adjacent to I-02, in the same `addExpense` controller but not itself a call to the ML
service:** a `MlFeedbackModel.save()` write occurs immediately before `newExpense.save()`
whenever a genuine prediction+correction was supplied. Unlike I-02's description-generation
call, this write has no dedicated `try/catch` — a failure here (validation error, duplicate
key, transient MongoDB error) propagates to the controller's outer `catch` and returns `500`,
**blocking the expense from ever being persisted**. Confirmed by direct inspection of
`addexpense.js:85-111`; see [ML-FLOW-09 §10 and §17](ml-flow-09-backend-integration.md) for full
detail. The two `.save()` calls are sequential, not wrapped in a MongoDB transaction.

## D. Data/artifact inventory

| Data/artifact | Producer | Storage location | Format/schema | Consumer | Lifecycle | Failure risk |
|---|---|---|---|---|---|---|
| Base training set | Pre-existing, static | `training/dataset/merged_expenses.csv` | CSV, `expenseName,expenseCategory` | C-05 | Never modified by this codebase's own logic | None confirmed |
| Per-run dataset snapshot | C-05 | `training/dataset/runs/<runId>/training_dataset.csv` | CSV | C-06 (trainer subprocess) | Immutable, never overwritten | Disk-full during temp write (caught, cleaned up) |
| Model bundle | C-06 | `training/models/model-<runId>/{model,vectorizer,labelEncoder}.pkl` + `metadata.json` | joblib + JSON | C-07, C-08, C-03 | Immutable once written; deleted only by C-10's retention policy | Partial write prevented by atomic rename |
| Active manifest | C-08 (via `_attempt_activation`) | `training/models/active.json` | JSON | C-03 (every process, at startup and lazily) | Overwritten atomically on each activation | Corrupt/missing → legacy fallback, never crashes |
| Legacy fixed model | Pre-existing, static | `training/model.pkl`, `vectorizer.pkl`, `labelEncoder.pkl` | joblib | C-03 (fallback only) | Never written to by any code in this repository | None — read-only bootstrap |
| Training-run records | C-12 | MongoDB `mltrainingruns` | Document | ML-API-06/07, C-09, C-18 | Created `queued`, ends at one of 6 terminal states | Orphaned by a process kill; recovered by ML-FLOW-08 |
| Training lock | C-12 | MongoDB `mltraininglocks` | Singleton document | ML-API-10, C-18 | Claimed/released per run; stale-reclaimable | Stale lock recovered via owner-checked reclaim |
| Feedback documents | Node backend (`addexpense.js`) | MongoDB `mlfeedbacks` (schema in `backend/config/Schemas.js`) | Document | C-05, C-13 | `pending → reserved → trained`/`needs_review` | Orphaned reservation recovered by ML-FLOW-08 |
| Legacy CSV exports (`export_feedback.py`, `merge_datasets.py` outputs) | Dead code, not invoked by the pipeline | `training/dataset/feedback_data.csv`, `retrain_data.csv` | CSV | None — superseded | Stale, not regenerated by the active pipeline | Misleading if read manually; never read by any active code path |
| Seed/reference datasets | Pre-existing, static | `usedDatasets/*.csv` (5 files) | CSV | None confirmed in active code | Historical reference only | Not read by any traced code path |
| Bundled test-integration artifact | `tests/integration/test_real_training.py` (test run) | `training/models/model-integration-test-run/` | joblib + JSON | Test suite only | Left on disk from a prior test run | Could be mistaken for a real candidate; classified `unknown`/`orphaned` by C-10's own logic if no matching run record exists |

Category count is never hard-coded anywhere in this documentation or its diagrams — the active
label set is always `labelEncoder.classes_` / `metadata.json`'s `encoderClasses`, sourced from
`training/category_config.py`'s `CANONICAL_CATEGORIES` (currently 15 entries) as most recently
baked into whichever model is active.

## E. Repository/collection inventory

| Repository operation | Collection | Input | Filter/identity | Mutation | Caller | Consistency concern |
|---|---|---|---|---|---|---|
| `create_run()` | `mltrainingruns` | trigger source | None (insert) | New document, `queued` | ML-API-10 | None — always a fresh insert |
| `mark_running/evaluating/activating/activated/failed*()` | `mltrainingruns` | run id | `_id` match | Status + timestamp fields | C-18 | No compare-and-set guard beyond the MongoDB single-document write itself |
| `try_claim_lock()` / `reclaim_stale_lock()` | `mltraininglocks` | run id | `locked: {$ne: true}` / exact stale owner + heartbeat age | `locked`, `runId`, `heartbeatAt` | ML-API-10 | Atomic `find_one_and_update` — confirmed race-safe |
| `release_lock()` | `mltraininglocks` | run id | `runId` match (owner-checked) | Clears lock fields | C-18 (finally block) | Cannot release a lock reassigned to a newer run |
| `reserve_pending_feedback()` | `mlfeedbacks` | run id | `status: "pending"`, one doc at a time | `status → reserved`, `trainingRunId` set | C-05 | One atomic op per document — no bulk atomic primitive in MongoDB, acknowledged in the code's own docstring |
| `finalize_trained_for_run()` | `mlfeedbacks` | run id | `status: "reserved"`, `trainingRunId` match | `status → trained` | ML-FLOW-06 (post-activation only) | Filtered on both fields — cannot touch another run's reservations |
| `release_reserved_for_run()` | `mlfeedbacks` | run id, reason | Same filter as above | `status → pending` | C-18 (failure paths) | Same double-filter guarantee |
| `ensure_indexes()` | `mltrainingruns` | None | None | Creates `{status,createdAt}` and `{modelVersion}` indexes | app startup | Idempotent; failure only degrades query performance, never correctness |

No unique index confirmed on `mltrainingruns.modelVersion` — `get_run_for_model_version()`
assumes at most one run per model version but nothing in the schema enforces this at the
database level; relies entirely on `model_version_for_run()`'s own collision-proof naming
(`model-<runId>`, where `runId` is already a unique MongoDB ObjectId).

## F. Environment-variable inventory

| Variable | Default if unset | Set in this repo's `.env`? | Consumer |
|---|---|---|---|
| `MONGO_CONN` | None — startup warning, not fatal | Yes | `db/mongo.py` |
| `MONGO_DB_NAME` | `"auth-db"` | No (uses default) | `db/mongo.py` |
| `ML_OPERATIONS_TOKEN` | Unset → operational endpoints fail-closed 503 | **No** | `status_api.py` |
| `ML_MODEL_ROOT` | `training/models` (next to `model_bundle.py`) | No (uses default) | `training/model_bundle.py` |
| `ML_RETRAIN_STALE_TIMEOUT_SECONDS` | `1800` | No | `app.py` |
| `ML_ORPHANED_RUN_THRESHOLD_SECONDS` | `300` | No | `app.py` |
| `ML_MANIFEST_CHECK_INTERVAL_SECONDS` | `5` | No | `inference/predictor_manager.py` |
| `ML_MAX_ACCURACY_REGRESSION` | `0.05` (validate_model.py's real fallback — **not** `0.02` as `.env.example` documents) | No | `training/validate_model.py` |
| `ML_FEEDBACK_DUPLICATE_CAP` | `3` | No | `training/dataset_builder.py` |
| `ML_MODEL_RETENTION_COUNT` | `5` | No | `training/model_cleanup.py` |
| `ML_REJECTED_MODEL_RETENTION_COUNT` | `3` | No | `training/model_cleanup.py` |
| `ML_MODEL_RETENTION_DAYS` | `7` | No | `training/model_cleanup.py` |

## G. Model-state ownership

| State | Owner | Scope |
|---|---|---|
| In-memory `RuntimeSnapshot` | `PredictorManager` singleton (`predictor_manager` module-level instance) | Per-process — every worker/replica has its own |
| Published "active" pointer | `training/models/active.json` | Shared filesystem/volume across all workers/replicas |
| Persisted run history | MongoDB `mltrainingruns` | Cluster-wide, shared with any future dashboard |
| Retraining lock | MongoDB `mltraininglocks` | Cluster-wide — the only thing that makes concurrent retraining safe across processes |

## H. Endpoint-to-component mapping

| Endpoint | Primary components |
|---|---|
| ML-API-01/02/03 | None beyond the route handler itself |
| ML-API-04 | C-03, C-15 |
| ML-API-05 | C-03, C-08, C-15 |
| ML-API-06/07 | C-12, C-15 |
| ML-API-08 | C-01, C-02, C-03 |
| ML-API-09 | C-04 |
| ML-API-10 | C-12, C-18 (→ C-05, C-06, C-07, C-08, C-09, C-10, C-13 transitively via ML-FLOW-07) |

## I. Dead/unused/legacy implementation

| File | Status | Evidence |
|---|---|---|
| `training/export_feedback.py` | Dead — superseded, not imported by the active pipeline | Own file-header comment: "Superseded by training/dataset_builder.py + db/feedback_repository.py; kept for reference, not wired in." No import of this module anywhere else in `ml-service/`. |
| `training/feedback/merge_datasets.py` | Dead — superseded | Own file-header comment: "Superseded by training/dataset_builder.py's build_snapshot_for_run; kept for reference, not read by trainer.py." No import elsewhere. |
| `training/dataset/feedback_data.csv`, `training/dataset/retrain_data.csv` | Stale artifacts | Outputs of the two dead scripts above; not read by any active code path (`dataset_builder.py` reads only `merged_expenses.csv` and MongoDB). |
| `training/models/model-integration-test-run/` | Test-only artifact left on disk | Name matches `tests/integration/test_real_training.py`'s own fixture naming convention, not a real `model-<ObjectId>` pattern any production run would produce. |
| `usedDatasets/*.csv` (5 files) | Historical reference, not read by active code | No import or file-open reference to `usedDatasets/` found anywhere under `ml-service/`. |

## J. Findings summary

See each workflow document's own "Confirmed limitations" section for full detail. The twelve
most significant, cross-cutting findings:

1. No service-to-service authentication between the Node backend and this service, on any of
   the four confirmed calls.
2. The three operational status endpoints are unconditionally 503 in this repo's `.env`.
3. `ML_MAX_ACCURACY_REGRESSION` default mismatch: `.env.example` says `0.02`, code's real
   fallback is `0.05`.
4. `generate-description`'s error-fallback log message ("falling back to \"Others\"") disagrees
   with its actual fallback value (`""`).
5. **A feedback-write failure blocks expense creation**, while an ML-description failure does
   not — `mlFeedback.save()` has no dedicated `try/catch` in `addexpense.js`, unlike the
   `generate-description` call, so a feedback-write error propagates to a `500` and the expense
   is never persisted.
6. **Feedback and expense persistence are not transactional** — two sequential `.save()` calls,
   no MongoDB session, confirmed by the absence of any transaction API usage in `addexpense.js`.
7. **The training-feedback loop only starts at expense creation, never at edit time** —
   confirmed absent from `editExpense.js` and `geteditexpense.js` by direct inspection.
8. All users' data trains one shared, global model — no data isolation between accounts in the
   training set.
9. A hard process kill during retraining silently loses the background thread; recovery is
   startup-only (ML-FLOW-08), never periodic.
10. No unique database index confirmed on `mltrainingruns.modelVersion`.
11. Five confirmed dead/superseded files still present in the repository (two scripts, two stale
    CSVs, one leftover test artifact).
12. No fixed category count anywhere in this documentation — the label set is dynamic, sourced
    from whichever model is currently active. **SIA is confirmed absent** from every call site
    this audit traced, consistent with the Report module's own confirmed no-ML/SIA-dependency
    finding — out of scope, not merely undocumented.

## K. Cross-links to existing modules

- Authentication's `verifyToken` middleware is the real access-control boundary for
  `/ml/predict-category` from a real user's perspective — see the Authentication module's
  [README](../auth/README.md) rather than re-documenting JWT verification here.
- `MlFeedbackSchema` and the Expense creation flow that writes to it belong to the Expense
  module's own domain — this document covers only the MongoDB collection this service reads
  from and writes to, not the full Expense CRUD lifecycle.
