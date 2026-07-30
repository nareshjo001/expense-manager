# ML Service — end-to-end lifecycle narrative

A single connected story from process start to a user seeing a predicted category, and from
accumulated corrections to a new model going live. Every stage links to its own full workflow
document; this page exists to show how they connect, not to duplicate their detail.

## 1. Process startup

`app.py` registers four `@app.on_event("startup")` handlers, run in this exact order:

1. **Config validation** (`config.py`) — fatal only for a syntactically-invalid `MONGO_CONN` or
   an unwritable `ML_MODEL_ROOT`; every other misconfiguration is a warning with a documented
   default.
2. **Predictor initialization** — [ML-FLOW-02](ml-flow-02-startup-loading.md): loads the
   manifest-referenced model, or falls back to the legacy fixed artifacts.
3. **Index creation** — idempotent MongoDB index setup for `mltrainingruns`.
4. **Training-run reconciliation** — [ML-FLOW-08](ml-flow-08-startup-reconciliation.md): three
   independent sweeps recovering from any crash window in the retraining lifecycle.

Only step 1's two named conditions abort startup; every other failure here is logged and the
process continues in a degraded-but-defined state (e.g. serving the legacy model).

## 2. A prediction request

[ML-API-08](ml-api-08-predict-category.md) → [ML-FLOW-01](ml-flow-01-prediction-pipeline.md):
snapshot acquired (with a lazy, throttled reload check) → text cleaned → TF-IDF transform →
RandomForest predicts → label decoded → confidence computed → response returned, always HTTP
200 even on an internal failure. See [ML-FLOW-09](ml-flow-09-backend-integration.md) for how
this connects to the actual user-facing form.

## 3. A retraining request

[ML-API-10](ml-api-10-retrain-model.md) accepts (202) or reports an already-active run (200) —
**never** waits for the pipeline below. The accepted request starts
[ML-FLOW-07](ml-flow-07-retraining-lifecycle.md), the umbrella background lifecycle:

1. [ML-FLOW-03](ml-flow-03-dataset-construction.md) — feedback reserved, dataset snapshot
   written and hashed.
2. [ML-FLOW-04](ml-flow-04-training-evaluation.md) — a subprocess trains and evaluates a fresh
   TF-IDF + RandomForest pipeline, writes an immutable candidate bundle.
3. [ML-FLOW-05](ml-flow-05-validation-promotion.md) — a second subprocess runs 9 ordered gates
   against the candidate.
4. [ML-FLOW-06](ml-flow-06-persistence-activation.md) — only on validation success: preload,
   publish the manifest, swap this process's live snapshot, smoke-test, finalize feedback.
5. Best-effort artifact cleanup, then the MongoDB lock is released.

## 4. Full state machine

| State | Entered by | Required prior state | Work performed | Success transition | Failure transition |
|---|---|---|---|---|---|
| `queued` | `create_run()` | — | Run record created | `running` | `failed` (startup orphan sweep only) |
| `running` | `mark_running()` | `queued` | ML-FLOW-03 + ML-FLOW-04 stages | `evaluating` | `failed` |
| `evaluating` | `mark_evaluating()` | `running` | ML-FLOW-05 (9 gates) | `activating` | `failed_validation` |
| `activating` | `mark_activating()` | `evaluating` | ML-FLOW-06 (preload/publish/swap/smoke) | `activated` | `failed_activation` |
| `activated` | `mark_activated()` | `activating` | Feedback finalized, cleanup runs | *(terminal)* | — |
| `failed` | `mark_failed()` | `queued`/`running` | Reserved feedback released to `pending` | — | *(terminal)* |
| `failed_validation` | `mark_failed_validation()` | `evaluating` | Reserved feedback released to `pending` | — | *(terminal)* |
| `failed_activation` | `mark_failed_activation()` | `activating` | Reserved feedback released to `pending` | — | *(terminal)* |
| `completed` *(legacy)* | `mark_completed()` | `evaluating` | Pre-Phase-E terminal success; no longer produced by new runs | — | — |

Six live terminal outcomes; `completed` is retained only for backward compatibility with
documents created before this activation workflow existed.

## 5. Recovery windows and their owning flow

| Crash window | Recovered by |
|---|---|
| Between `create_run()` and ever reaching `running` | [ML-FLOW-08](ml-flow-08-startup-reconciliation.md), sweep 1 (stale `queued`) |
| Mid-training or mid-validation subprocess | [ML-FLOW-08](ml-flow-08-startup-reconciliation.md), sweep 1 (lock-mismatched `running`/`evaluating`) |
| A feedback document left `reserved` by a dead run | [ML-FLOW-08](ml-flow-08-startup-reconciliation.md), sweep 2, or the next run's own `reserve_feedback_for_run()` |
| Between manifest publication and this process's own swap/smoke confirmation | [ML-FLOW-06](ml-flow-06-persistence-activation.md)'s own in-request rollback, or [ML-FLOW-08](ml-flow-08-startup-reconciliation.md) sweep 3 if the process dies first |
| An already-`activated` run whose feedback finalization itself failed | [ML-FLOW-08](ml-flow-08-startup-reconciliation.md), sweep 3, case 2 |

## 6. What "confirmed" means throughout this documentation set

Every claim in this module's documents was verified against the current repository — by reading
the exact file and function cited, not by trusting a prior report's description of what the
service "should" do. Where an existing report (`ML_SERVICE_IMPLEMENTATION_REPORT.md`) was
consulted for context, its claims were independently re-checked against the current source before
being repeated here; see each workflow document's own limitations section for any place a prior
report's description no longer matches the code exactly (none were found to materially
disagree — the implementation report's own workflow narrative, section 3, matches this
documentation's stage breakdown).
