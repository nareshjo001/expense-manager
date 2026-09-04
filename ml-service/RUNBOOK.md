# BALENISA ml-service — Operational Runbook

This runbook covers day-to-day operation of the retraining/activation
lifecycle built across Phases A–G. It assumes the reader has repo access
but does not assume any specific host, cloud account, or credentials —
placeholders are used throughout; substitute your own deployment's values.

## 1. Startup

**Required environment variables** (see `.env.example` for the full list):

- `MONGO_CONN` — MongoDB connection string. Without it, `/predict-category`
  still works (predictions never touch Mongo), but `/retrain-model`,
  startup reconciliation, and the operational status endpoints will fail.
- `MONGO_DB_NAME` — defaults to `auth-db` if unset.

**Optional but recommended:**

- `ML_OPERATIONS_TOKEN` — required to call `/ml-status` and
  `/training-runs*`. Without it, those two endpoints respond `503` (fail
  closed), which is the intended degrade-safely behavior, not a bug.
- `ML_MODEL_ROOT` — where versioned model bundles + `active.json` live.
  Defaults to `training/models` next to the service code if unset.

**Install dependencies** (pinned versions, see `requirements.txt`):

```bash
python -m venv venv
source venv/bin/activate        # or venv\Scripts\activate on Windows
pip install -r requirements.txt
```

**Verify MongoDB connectivity** before starting the service in a new
environment — a quick manual check:

```bash
python -c "from pymongo import MongoClient; MongoClient('<MONGO_CONN>', serverSelectionTimeoutMS=3000).admin.command('ping')"
```

**Verify the model root is writable:**

```bash
python -c "import os; os.makedirs('<ML_MODEL_ROOT>', exist_ok=True); print(os.access('<ML_MODEL_ROOT>', os.W_OK))"
```

**Start the service:**

```bash
uvicorn app:app --host 0.0.0.0 --port 8000 --workers 2
```

At startup, the service logs one `config_validated` event (counts only —
never secret values), then attempts predictor initialization. If neither
`active.json`'s referenced bundle NOR the legacy fixed artifacts
(`training/model.pkl` etc.) can be loaded, startup fails loudly — this is
the one condition where failing to start is intentional (see Phase E).

## 2. Health checks

- `GET /health/live` — process is alive. Never touches Mongo or the model.
  Use for a liveness probe (restart the process if this ever fails).
- `GET /health/ready` — can this process currently serve predictions right
  now (snapshot loaded + a cheap smoke prediction succeeds). Returns `503`
  when not ready. Use for a readiness probe (stop routing traffic here,
  don't restart, if this fails — the process may still recover on its own
  via the multi-worker reload mechanism).
- `GET /ml-status` (requires `X-ML-Operations-Token`) — full picture: which
  model version is loaded in *this* process, what `active.json` currently
  points at, whether they agree (`synchronized`), and reload diagnostics
  (last check/attempt/success/error timestamps, cumulative failure count).

## 3. Retraining

- Trigger: `POST /retrain-model` (optionally `{"source": "manual"}` — falls
  back to `"api"` for anything unrecognized).
- Duplicate trigger behavior: if a run is already active for this process's
  lock, the response is `200` with `"existingRun": true` and the existing
  run's id/status — no new run record is created.
- Look up a specific run: `GET /training-runs/{runId}` (requires the
  operations token). Returns `404` for both "malformed id" and "no such
  run" (never distinguishes the two to an external caller).
- List recent runs: `GET /training-runs?limit=20&status=activated&before=<cursor>`
  (requires the operations token). `limit` is clamped to `[1, 100]`.
- Expected status sequence on success:
  `queued → running → evaluating → activating → activated`.
- Expected status sequence on a rejected candidate:
  `queued → running → evaluating → failed_validation`.
- Expected status sequence on an activation problem:
  `queued → running → evaluating → activating → failed_activation`.

### 3.1 Manual promotion gate (ML-001-T06)

By default, a validated candidate activates automatically the instant
validation succeeds (the sequence above) — this is unchanged unless you
deliberately opt in below.

- `ML_REQUIRE_MANUAL_APPROVAL` (default: unset / `false`) — set to
  `true`/`1`/`yes`/`on` to require a human decision before a validated
  candidate goes live. With it set, a successful validation stops at
  `awaiting_approval` instead of activating automatically:
  `queued → running → evaluating → awaiting_approval → activated | rejected`.
  Nothing else about training/validation changes — the same 9 gates run
  the same way either way; this flag only gates what happens *after* they
  pass. See `docs/ml/ML-001-T06-promotion-and-rollback.md` for what to
  review before approving a candidate, and note that flag stays `false` on
  this deployment until whoever owns this service deliberately changes it
  — this document does not itself change production behavior.
- `POST /training-runs/{runId}/approve` (requires the operations token) —
  only valid while the run is `awaiting_approval` (`409` otherwise, `404`
  for an unknown run). Calls the exact same activation workflow the
  automatic path uses (preload/validate → publish manifest → swap →
  smoke test), so an approved run reaches the same `activated` end state.
  `422` if activation itself fails (the candidate could not be safely
  promoted) — the run is left `failed_activation`, same as the automatic
  path's own failure handling.
- `POST /training-runs/{runId}/reject` (requires the operations token,
  optional JSON body `{"reason": "..."}`) — only valid while the run is
  `awaiting_approval`. Sets the run to a terminal `rejected` status.
  Never touches `active.json` and never deletes the candidate bundle —
  it is left on disk exactly as training produced it, in case the
  decision is later reversed (see 5.1 below).

## 4. Failure diagnosis

| Status | Meaning | Where to look |
|---|---|---|
| `failed` | Training itself broke before producing a candidate bundle | `failureReason` field on the run |
| `failed_validation` | A candidate bundle was produced but rejected by one of the 9 validation gates | `validation` field on the run (per-gate results) |
| `failed_activation` | Validation passed, but manifest publication / runtime swap / post-swap smoke test failed | `activation` field on the run (`failedAtStage`, `rollback` outcome) |
| `bookkeepingWarning` present on an `activated` run | The model IS live and correct — only the "mark feedback as trained" bookkeeping step failed | Next startup's reconciliation pass finalizes this automatically; can also be checked via `GET /training-runs/{runId}` |
| `synchronized: false` in `/ml-status` | This process's in-memory model disagrees with what `active.json` currently points at | Wait up to `ML_MANIFEST_CHECK_INTERVAL_SECONDS` for the next prediction request to trigger a lazy reload, or check `reloadDiagnostics.lastReloadError` for why it might be stuck |
| `awaiting_approval` | Validation passed and `ML_REQUIRE_MANUAL_APPROVAL` is on; the candidate is publishable but nothing has been made live yet | `POST /training-runs/{runId}/approve` or `/reject` (section 3.1) |
| `rejected` | A human explicitly declined to promote a candidate that was `awaiting_approval` | `rejectionReason` field on the run; candidate bundle is still on disk, untouched |

## 5. Recovery

- **Service restart:** on startup, three independent reconciliation sweeps
  run automatically (queued/running orphan cleanup, feedback-reservation
  cleanup, activation-state reconciliation) — see the single
  `run_reconciliation` log event for a structured summary of what each one
  did. None of this requires manual intervention in the common case.
- **Activating-run reconciliation:** if the process crashed mid-activation,
  the next startup re-reads `active.json` and MongoDB independently to
  decide whether the crash happened before or after publication, and
  resolves the run to `activated` or `failed_activation` accordingly — see
  `activatingRunsRecovered` / `activatingRunsFailed` in the
  `run_reconciliation` log.
- **Feedback reconciliation:** feedback left `reserved` by a run that is
  now terminal (or no longer exists) is returned to `pending` at the next
  startup — see the `feedback_reconciliation` log event (distinct from
  `run_reconciliation`, which is about training-run documents, not
  feedback documents).
- **Automatic same-request manifest rollback:** if activation fails after
  the manifest was already published, the previous manifest (or its
  absence, for a first activation attempt) is restored automatically
  within the same request — no manual manifest editing is required for
  this case.

### 5.1 Manual rollback (ML-001-T06, "break glass")

For the case the automatic rollback above does NOT cover — a model that
activated successfully, has been live for a while, and only later turns
out to be regressing in some way the 9 validation gates didn't catch
(they check what they check; a live-traffic issue surfacing after the
fact is exactly what they cannot see) — `training/rollback_model.py` lets
an operator explicitly reactivate an older, still-on-disk bundle:

```bash
cd training
python3 rollback_model.py --list
python3 rollback_model.py --model-version model-<runId> --reason "regressed on <category> after activation"
```

- `--list` prints every currently complete, on-disk bundle (newest first)
  as JSON — never modifies anything.
- `--model-version` reactivates that exact bundle: it publishes a new
  `active.json` generation pointing at it (via the same
  `model_bundle.build_manifest`/`write_manifest` every other activation
  path uses), after confirming the target actually loads (the same Gate-2
  loadability check the forward path relies on). `--reason` is optional
  free text, echoed back in the printed result.
- This is a filesystem-level operation, not an HTTP endpoint — it relies
  on the same manifest-generation polling every worker already uses to
  converge on a normal forward activation (`ML_MANIFEST_CHECK_INTERVAL_SECONDS`,
  default 5s). See the module's own docstring for why rollback is
  deliberately kept as an operator-run script rather than a network
  endpoint: it is a rare, high-stakes action better gated by the same
  access an operator already needs to touch this host's other
  configuration, not by knowledge of one shared HTTP token.
- Refuses (and changes nothing) if the target is already active, is not a
  complete bundle, or fails to load — see `training/rollback_model.py`'s
  `RollbackError` messages for exactly which.

## 6. Artifact maintenance

- Retention defaults: keep the newest 5 validated-but-superseded bundles
  (`ML_MODEL_RETENTION_COUNT`), the newest 3 rejected bundles
  (`ML_REJECTED_MODEL_RETENTION_COUNT`), and never delete anything younger
  than 7 days (`ML_MODEL_RETENTION_DAYS`) regardless of count.
- Cleanup runs automatically, best-effort, right after a successful
  activation — a cleanup failure never affects activation or feedback
  state (see the `artifact_cleanup` log event for its outcome).
- Dry run (no filesystem changes) from a Python shell in the service's
  environment:
  ```python
  from training import model_cleanup
  from db import training_run_repository as runs
  plan = model_cleanup.plan_cleanup(runs.get_run_for_model_version, runs.find_runs_by_status)
  print(plan)  # {"candidates": [...], "summary": {"delete": N, "keep": N}}
  ```
- Protected bundles (never deleted, under any count/age policy): the
  currently active model, the immediately-previous (rollback) model, and
  any bundle whose run is still `running`/`evaluating`/`activating`.
- Shared-filesystem requirement: multiple worker processes on ONE host
  sharing local disk works today. Multiple replicas on SEPARATE disks do
  NOT stay synchronized — the manifest-generation reload mechanism has no
  network coordination of any kind. Multiple replicas sharing one durable,
  atomic-rename-capable filesystem (e.g. a shared volume, not object
  storage) are supported, subject to that filesystem's own consistency
  guarantees — this has not been validated against any specific shared
  storage product.
