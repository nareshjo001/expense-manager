import os
import time
from threading import Thread
from typing import Optional

from fastapi import FastAPI, HTTPException, Response, Header
from fastapi.responses import JSONResponse
from pydantic import BaseModel, RootModel

from inference.predictor import predict_category
from inference.predictor_manager import predictor_manager, ActivationError
from inference.descriptionGenerator import (
    generate_description_response
)
from training.retrain_pipeline import run_retraining
from training import model_bundle
from training import model_cleanup
from db import training_run_repository as runs
from db import feedback_repository as feedback
import status_api
import config as ml_config
from observability import log_event, sanitize_reason

app = FastAPI()

# How long a "running" lock can go without a heartbeat before a new request may reclaim it as abandoned.
STALE_RUN_TIMEOUT_SECONDS = int(
    os.getenv("ML_RETRAIN_STALE_TIMEOUT_SECONDS", "1800")  # 30 minutes
)

# How old a "queued"/lock-orphaned "running" run must be before startup reconciliation treats it as abandoned.
ORPHANED_RUN_THRESHOLD_SECONDS = int(
    os.getenv("ML_ORPHANED_RUN_THRESHOLD_SECONDS", "300")  # 5 minutes
)


class PredictionRequest(BaseModel):
    expenseName: str


class DescriptionRequest(BaseModel):
    expenseName: str
    expenseCategory: str
    expenseAmount: float


class RetrainTriggerRequest(BaseModel):
    # Resolved against an allowed set; missing or unrecognized falls back to "api".
    source: Optional[str] = None


@app.on_event("startup")
def validate_configuration_on_startup():
    """
    Phase G item 10: centralized startup configuration validation.
    Registered FIRST (FastAPI runs startup handlers in registration order)
    so a fatal configuration problem (an unwritable ML_MODEL_ROOT, or a
    MONGO_CONN that isn't even a syntactically valid Mongo URI) is caught
    before predictor initialization or any Mongo-backed reconciliation
    attempts to run against it.

    Only raises for the two conditions config.py itself classifies as
    fatal (see its own docstring for why exactly these two, and no
    others) -- everything else (missing MONGO_CONN entirely, missing
    ML_OPERATIONS_TOKEN, an out-of-range retention/interval/threshold
    value) is logged as a warning and left to each consuming module's own
    existing, already-safe fallback-to-default behavior from Phases B-F.
    """
    result = ml_config.run_and_log_startup_validation()
    if result["errors"]:
        raise ml_config.ConfigurationError(
            "Fatal ml-service configuration problem(s): " + "; ".join(result["errors"])
        )


@app.on_event("startup")
def initialize_predictor_on_startup():
    """
    Phase E: registered BEFORE the reconciliation handler below (FastAPI
    runs startup handlers in registration order), so this process has a
    usable RuntimeSnapshot before any activation-related reconciliation
    logic (which itself may need to preload/swap a candidate) ever runs.

    Deliberately allowed to propagate ActivationError -- per the Phase E
    spec, startup must fail if, and only if, NEITHER a manifest-referenced
    model NOR the legacy fixed artifacts can be loaded at all (i.e. this
    process would otherwise start with nothing to serve predictions with).
    predictor_manager.initialize() itself already prefers the legacy
    fallback over failing whenever the manifest is unusable but the legacy
    artifacts are fine -- see its own docstring.
    """
    predictor_manager.initialize()


# Most recent startup reconciliation summary, kept in memory only so a caller can inspect the last pass.
_last_reconciliation_summary = None


@app.on_event("startup")
def ensure_indexes_on_startup():
    """
    Phase F: idempotent MongoDB index creation for the query patterns the
    new operational status API relies on (status+createdAt, modelVersion
    -- see db.training_run_repository.ensure_indexes). Registered before
    the reconciliation handler purely so indexes exist before
    reconciliation's own queries run, though neither actually depends on
    the other's success -- both are independently best-effort and never
    block startup.
    """
    try:
        runs.ensure_indexes()
    except Exception as exc:
        print(f"[startup] warning: index creation skipped ({type(exc).__name__}: {exc})")


@app.on_event("startup")
def reconcile_training_runs_on_startup():
    """
    Startup reconciliation. Phase F extends this to RETURN (and log, as a
    single summarized event) a structured count breakdown instead of only
    printing ad hoc messages at each individual step -- see the module-level
    `_last_reconciliation_summary` and the "run_reconciliation" log event
    below.

    Still composed of the same three independent, best-effort sweeps as
    before (Phase B.1's orphaned-run sweep, Phase C's feedback-reservation
    sweep, Phase E's activation-aware sweep), in the same order, with the
    same "a failure in one sweep must never block startup or the other
    sweeps" guarantee. Each sweep's own try/except is unchanged in spirit;
    what changes is that failures are also collected into a structured
    `errors` list, not just printed.
    """
    global _last_reconciliation_summary

    summary = {
        "queuedRunsFailed": 0,
        "runningRunsFailed": 0,
        "activatingRunsRecovered": 0,
        "activatingRunsFailed": 0,
        "feedbackReturnedToPending": 0,
        "feedbackFinalizedToTrained": 0,
        "errors": [],
    }

    try:
        run_result = runs.reconcile_orphaned_runs(ORPHANED_RUN_THRESHOLD_SECONDS)
        summary["queuedRunsFailed"] = run_result["queuedRunsFailed"]
        summary["runningRunsFailed"] = run_result["runningRunsFailed"]
        summary["errors"].extend(run_result["errors"])
        if run_result["queuedRunsFailed"] or run_result["runningRunsFailed"]:
            print(
                f"[startup] reconciled {run_result['queuedRunsFailed']} queued and "
                f"{run_result['runningRunsFailed']} running/evaluating orphaned run(s)"
            )
    except Exception as exc:
        summary["errors"].append(f"training-run reconciliation: {sanitize_reason(exc)}")
        print(
            f"[startup] warning: training-run reconciliation skipped "
            f"({type(exc).__name__}: {exc})"
        )

    # Recover feedback left "reserved" by a now-terminal or missing run; runs after run reconciliation above.
    try:
        active_lock = runs.get_active_lock() or {}
        active_run_id = active_lock.get("runId") if active_lock.get("locked") else None
        released = feedback.reconcile_reserved_feedback(runs.get_run, active_run_id)
        summary["feedbackReturnedToPending"] += released
        if released:
            log_event("feedback_reconciliation", feedbackCount=released, outcome="returned_to_pending")
            print(f"[startup] released {released} orphaned reserved feedback document(s) to pending")
    except Exception as exc:
        summary["errors"].append(f"feedback reservation reconciliation: {sanitize_reason(exc)}")
        print(
            f"[startup] warning: feedback reservation reconciliation skipped "
            f"({type(exc).__name__}: {exc})"
        )

    # Activation-aware reconciliation; runs last so it only reasons about otherwise-consistent state.
    try:
        activation_result = _reconcile_activation_state()
        summary["activatingRunsRecovered"] += activation_result["activatingRunsRecovered"]
        summary["activatingRunsFailed"] += activation_result["activatingRunsFailed"]
        summary["feedbackReturnedToPending"] += activation_result["feedbackReturnedToPending"]
        summary["feedbackFinalizedToTrained"] += activation_result["feedbackFinalizedToTrained"]
        summary["errors"].extend(activation_result["errors"])
    except Exception as exc:
        summary["errors"].append(f"activation-state reconciliation: {sanitize_reason(exc)}")
        print(
            f"[startup] warning: activation-state reconciliation skipped "
            f"({type(exc).__name__}: {exc})"
        )

    _last_reconciliation_summary = summary
    log_event(
        "run_reconciliation",
        queuedRunsFailed=summary["queuedRunsFailed"],
        runningRunsFailed=summary["runningRunsFailed"],
        activatingRunsRecovered=summary["activatingRunsRecovered"],
        activatingRunsFailed=summary["activatingRunsFailed"],
        feedbackReturnedToPending=summary["feedbackReturnedToPending"],
        feedbackFinalizedToTrained=summary["feedbackFinalizedToTrained"],
        errorCount=len(summary["errors"]),
    )


def _manifest_matches_run(manifest, run):
    """True iff a (non-None) manifest's runId matches this run's own id."""
    return manifest is not None and str(manifest.get("runId")) == str(run.get("runId"))


def _bundle_valid_for_manifest(manifest):
    """
    Cheap, read-only check of whether a manifest's referenced bundle is
    complete and internally consistent enough to be worth attempting a
    real preload -- NOT a substitute for predictor_manager's own full
    runtime validation (feature/encoder compatibility, smoke prediction),
    which is what actually decides whether the candidate can be trusted;
    this is just a fast pre-filter to avoid attempting a load for an
    obviously-incomplete bundle.
    """
    if manifest is None:
        return False
    return model_bundle.is_bundle_complete(manifest["modelVersion"])


def _reconcile_activating_run(run, manifest):
    """
    Phase E startup reconciliation for a run found stuck in "activating"
    (i.e. the process that started activating it crashed or was killed
    before recording a terminal activation outcome).

    Per the Phase E spec:
      - if the CURRENT manifest points to this exact run, and its bundle is
        valid -> the publish step must have already succeeded before the
        crash. Initialize this process's own runtime from it (so this
        process is actually serving what the manifest claims is active),
        mark the run "activated", and finalize its reserved feedback.
      - otherwise (no manifest, or it points to a different run) -> this
        run's activation never completed publication; it is resolved as
        "failed_activation" and its reservations are released to "pending"
        (manifest and runtime are both left completely alone -- there is
        nothing of this run's to roll back on the manifest side, since it
        never got that far).

    Phase F: returns a structured outcome dict instead of only printing,
    so the caller (_reconcile_activation_state) can fold this into the
    overall structured reconciliation summary:

        {"outcome": "activated"|"failed_activation"|"left_as_is",
         "feedbackFinalized": int, "feedbackReturnedToPending": int,
         "error": str or None}
    """
    run_id = run["runId"]

    if _manifest_matches_run(manifest, run) and _bundle_valid_for_manifest(manifest):
        try:
            snapshot = predictor_manager.preload_candidate(
                manifest["modelVersion"], run_id, manifest.get("generation", 0)
            )
            predictor_manager.swap_in(snapshot)
            smoke_ok, smoke_reason = predictor_manager.smoke_test()
            if not smoke_ok:
                raise ActivationError(f"post-swap smoke test failed: {smoke_reason}")

            runs.mark_activated(
                run_id,
                {
                    "passed": True,
                    "loadedModelVersion": manifest["modelVersion"],
                    "manifestGeneration": manifest.get("generation", 0),
                    "failureReason": None,
                    "reconciledAtStartup": True,
                },
                manifest.get("generation", 0),
                manifest.get("publishedAt"),
            )
            finalized = 0
            try:
                finalized = feedback.finalize_trained_for_run(run_id)
                if finalized:
                    print(f"[startup] reconciled 'activating' run {run_id}: activated, finalized {finalized} feedback document(s)")
            except Exception as exc:
                runs.mark_bookkeeping_warning(run_id, str(exc))
                print(f"[startup] warning: reconciled run {run_id} as activated but feedback finalization failed: {exc}")
            return {"outcome": "activated", "feedbackFinalized": finalized,
                    "feedbackReturnedToPending": 0, "error": None}
        except Exception as exc:
            # Manifest claims this candidate is published, but it couldn't load/validate here -- leave as-is.
            sanitized = sanitize_reason(exc)
            print(
                f"[startup] warning: 'activating' run {run_id}'s manifest-referenced "
                f"candidate could not be reconciled ({exc}); leaving run status as-is"
            )
            return {"outcome": "left_as_is", "feedbackFinalized": 0,
                    "feedbackReturnedToPending": 0, "error": sanitized}

    # No manifest, or it doesn't reference this run -- publication never happened; release its reservations.
    runs.mark_failed_activation(
        run_id, "manifest does not reference this run at startup reconciliation"
    )
    released = feedback.release_reserved_for_run(
        run_id, "activation run reconciled as failed_activation at startup"
    )
    print(
        f"[startup] reconciled 'activating' run {run_id}: failed_activation, "
        f"released {released} feedback document(s) to pending"
    )
    return {"outcome": "failed_activation", "feedbackFinalized": 0,
            "feedbackReturnedToPending": released, "error": None}


def _reconcile_activation_state():
    """
    Phase E startup reconciliation, covering three cases the pre-existing
    Phase B.1/C/D sweeps know nothing about (they are entirely unaware of
    the manifest file):

      1. A run stuck in "activating" after a crash -- see
         _reconcile_activating_run above.
      2. A run already "activated" but with feedback still "reserved"
         (the process crashed between mark_activated and
         finalize_trained_for_run, or finalize_trained_for_run itself
         failed and left a bookkeeping warning) -- finalized here.
      3. The manifest points to a run that is still sitting in a
         PRE-activation status (e.g. "evaluating", or the legacy
         "completed") -- meaning publication+local activation apparently
         already happened (the manifest says so) but this run's own status
         was never advanced, most likely because the process crashed
         before even reaching mark_activating. Reconciled the same way as
         case 1's happy path, after independently re-verifying the bundle.

    Every decision here is driven by re-reading the manifest and
    re-verifying bundle completeness -- never by trusting a MongoDB status
    field alone, per the Phase E spec's explicit instruction.

    Phase F: bounded (this only ever scans runs currently in "activating"
    or "activated" status -- via find_runs_by_status, itself a targeted
    query, never a full collection scan) and returns a structured summary:

        {"activatingRunsRecovered": int, "activatingRunsFailed": int,
         "feedbackFinalizedToTrained": int, "feedbackReturnedToPending": int,
         "errors": [str, ...]}
    """
    result = {
        "activatingRunsRecovered": 0,
        "activatingRunsFailed": 0,
        "feedbackFinalizedToTrained": 0,
        "feedbackReturnedToPending": 0,
        "errors": [],
    }

    try:
        manifest = model_bundle.read_manifest()
    except model_bundle.ManifestError as exc:
        print(f"[startup] warning: active.json is invalid during reconciliation, treating as absent: {exc}")
        result["errors"].append(f"manifest invalid: {sanitize_reason(exc)}")
        manifest = None

    # Case 1: runs stuck in "activating".
    for run in runs.find_runs_by_status(["activating"]):
        outcome = _reconcile_activating_run(run, manifest)
        if outcome["outcome"] == "activated":
            result["activatingRunsRecovered"] += 1
        elif outcome["outcome"] == "failed_activation":
            result["activatingRunsFailed"] += 1
        result["feedbackFinalizedToTrained"] += outcome["feedbackFinalized"]
        result["feedbackReturnedToPending"] += outcome["feedbackReturnedToPending"]
        if outcome["error"]:
            result["errors"].append(outcome["error"])

    # Case 2: runs already "activated" with leftover reserved feedback.
    for run in runs.find_runs_by_status(["activated"]):
        try:
            reserved = feedback.get_reserved_for_run(run["runId"])
        except Exception as exc:
            result["errors"].append(f"checking reserved feedback for {run['runId']}: {sanitize_reason(exc)}")
            print(f"[startup] warning: could not check reserved feedback for activated run {run['runId']}: {exc}")
            continue
        if reserved:
            try:
                finalized = feedback.finalize_trained_for_run(run["runId"])
                result["feedbackFinalizedToTrained"] += finalized
                print(f"[startup] finalized {finalized} leftover reserved feedback document(s) for already-activated run {run['runId']}")
            except Exception as exc:
                runs.mark_bookkeeping_warning(run["runId"], str(exc))
                result["errors"].append(f"finalizing leftover feedback for {run['runId']}: {sanitize_reason(exc)}")
                print(f"[startup] warning: could not finalize leftover feedback for activated run {run['runId']}: {exc}")

    # Case 3: manifest points to a run stuck pre-activation (evaluating/completed) -- reconcile like case 1.
    if manifest is not None:
        referenced_run = runs.get_run(manifest.get("runId"))
        if referenced_run and referenced_run.get("status") in ("evaluating", "completed"):
            if _bundle_valid_for_manifest(manifest):
                outcome = _reconcile_activating_run(referenced_run, manifest)
                if outcome["outcome"] == "activated":
                    result["activatingRunsRecovered"] += 1
                elif outcome["outcome"] == "failed_activation":
                    result["activatingRunsFailed"] += 1
                result["feedbackFinalizedToTrained"] += outcome["feedbackFinalized"]
                result["feedbackReturnedToPending"] += outcome["feedbackReturnedToPending"]
                if outcome["error"]:
                    result["errors"].append(outcome["error"])
            else:
                print(
                    f"[startup] warning: manifest references run {manifest.get('runId')} "
                    f"(status={referenced_run.get('status')}) but its bundle is not valid; "
                    f"leaving run status as-is"
                )

    return result


@app.head("/")
def health_head():
    return Response(status_code=200)


@app.get("/")
def health():
    return {
        "status": "running"
    }


def _require_operations_token(x_ml_operations_token):
    """
    Shared guard for the three operational endpoints (Phase F item 7,
    shared-secret policy). Fails closed: if ML_OPERATIONS_TOKEN is not
    configured at all, this ALWAYS raises 503 -- there is no
    "operational endpoints are open when no token is set" fallback.
    Otherwise, a missing or incorrect token raises 401. The token itself
    is never included in any exception detail or log call.
    """
    if not status_api.operations_token_configured():
        raise HTTPException(
            status_code=503,
            detail="Operational endpoints are not configured."
        )
    if not status_api.check_operations_token(x_ml_operations_token):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid operations token."
        )


@app.get("/health/live")
def health_live():
    """
    Phase F liveness probe: "is this process able to serve HTTP at all".
    Never touches MongoDB, never touches the predictor manager, never
    triggers a reload -- see status_api.build_liveness's own docstring.
    """
    return status_api.build_liveness()


@app.get("/health/ready")
def health_ready():
    """
    Phase F readiness probe: "can this process currently serve valid
    predictions". Returns a non-2xx status when NOT ready (a load
    balancer / orchestrator is expected to stop routing traffic here in
    that case) -- see status_api.build_readiness's own docstring for
    exactly what is checked and why it stays cheap.
    """
    ready, body = status_api.build_readiness(predictor_manager)
    if not ready:
        return JSONResponse(status_code=503, content=body)
    return JSONResponse(status_code=200, content=body)


@app.get("/ml-status")
def ml_status(x_ml_operations_token: Optional[str] = Header(None)):
    """
    Phase F: sanitized live-model status snapshot -- see
    status_api.build_ml_status for the exact contract. Protected by the
    shared-secret operations token (see _require_operations_token).
    """
    _require_operations_token(x_ml_operations_token)
    return status_api.build_ml_status(predictor_manager)


@app.get("/training-runs/{run_id}")
def training_run_detail(run_id: str, x_ml_operations_token: Optional[str] = Header(None)):
    """
    Phase F: sanitized single-run detail view. Returns 404 (not a raw
    MongoDB "not found", and not a 400) for both "run_id is not a valid
    ObjectId" and "no such run exists" -- deliberately not distinguishing
    the two to an external caller, since neither case should leak
    anything about MongoDB's own id format validation.
    """
    _require_operations_token(x_ml_operations_token)
    detail = status_api.get_run_detail(run_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="No such training run.")
    return detail


@app.get("/training-runs")
def training_run_list(
    limit: int = 20,
    status: Optional[str] = None,
    before: Optional[str] = None,
    x_ml_operations_token: Optional[str] = Header(None),
):
    """
    Phase F: bounded, sorted, sanitized run listing -- see
    status_api.list_runs_response / db.training_run_repository.list_runs
    for the exact bounds (limit clamped to [1, 100], default 20) and
    cursor semantics. An unrecognized `status` filter or malformed
    `before` cursor is rejected with 400, never silently ignored.
    """
    _require_operations_token(x_ml_operations_token)
    try:
        return status_api.list_runs_response(limit=limit, status=status, before=before)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=sanitize_reason(str(exc), max_length=200))


@app.post("/predict-category")
def predict(
    data: PredictionRequest,
    x_ml_operations_token: Optional[str] = Header(None),
):
    """
    Remediation Workstream C -- this endpoint previously had NO
    authentication at all, unlike /ml-status and /training-runs* (which have
    always required the shared-secret operations token). Reuses the exact
    same fail-closed guard (_require_operations_token /
    status_api.check_operations_token) rather than introducing a second,
    redundant secret -- there is no evidence a separate privilege tier is
    needed between "can read operational status" and "can request a
    prediction/trigger retraining"; both are backend-only, service-to-service
    calls today (see Routes/ml.router.js, Controllers/ExpenseControllers/
    addexpense.js, cron/feedbackCollector.js on the Node side). The token
    check runs BEFORE any prediction work, so a rejected caller never
    triggers the actual inference.
    """
    _require_operations_token(x_ml_operations_token)
    return predict_category(
        data.expenseName
    )


@app.post("/generate-description")
def generate_description_api(
    data: DescriptionRequest,
    x_ml_operations_token: Optional[str] = Header(None),
):
    """
    Remediation Workstream C -- same fail-closed operations-token guard as
    /predict-category above; see that endpoint's doc comment for the full
    rationale. Checked before any description-generation work runs.
    """
    _require_operations_token(x_ml_operations_token)
    return generate_description_response(
        expense_name=data.expenseName,
        category=data.expenseCategory,
        amount=data.expenseAmount
    )
class SpendingForecastRequest(RootModel[dict]):
    """Arbitrary JSON payload for spending forecast endpoint"""
    pass

@app.post("/predict-spending-forecast")
def predict_spending_forecast(
    data: SpendingForecastRequest,
    x_ml_operations_token: Optional[str] = Header(None)
):
    """
    Returns ML forecast for the current month spending.
    Requires the operations token guard.
    """
    _require_operations_token(x_ml_operations_token)
    payload = data.root
    from inference.spend_forecaster import predict_spending_snapshot
    result = predict_spending_snapshot(payload)
    return JSONResponse(status_code=200, content=result)

def _heartbeat(run_id):
    """
    Best-effort heartbeat update passed into run_retraining() as its stage
    callback. A heartbeat write failure must never abort an in-progress
    training run, so any error here is swallowed.
    """
    try:
        runs.update_heartbeat(run_id)
    except Exception:
        pass


def _attach_pipeline_bookkeeping(run_id, result):
    """
    Best-effort persistence of Phase C dataset/reservation bookkeeping onto
    the run record. Never allowed to affect the run's own success/failure
    outcome -- if this write itself fails, it is logged and swallowed; the
    run's actual terminal status is decided independently by the caller.
    """
    reserved_ids = result.get("reservedFeedbackIds") or []
    if reserved_ids:
        try:
            runs.attach_reserved_feedback_ids(run_id, reserved_ids)
        except Exception:
            print(f"[background_retrain] warning: could not record reserved feedback ids for run {run_id}")

    dataset_metadata = result.get("datasetMetadata")
    if dataset_metadata:
        try:
            runs.attach_dataset_metadata(run_id, dataset_metadata)
        except Exception:
            print(f"[background_retrain] warning: could not record dataset metadata for run {run_id}")


def _fetch_baseline(run_id):
    """
    Phase E: baseline source changed from "the latest completed/validated
    run" (Phase D) to "the run that is actually PUBLISHED/ACTIVATED right
    now" (per the Phase E spec's item 15 -- the regression baseline must
    represent current LIVE behavior, not merely the latest experiment,
    which could be a candidate that was never activated, or that lost a
    race to a different run's activation).

    Source of truth: training/models/active.json's own `runId`, looked up
    against `mltrainingruns` for its metrics/encoderClasses. Deliberately
    does NOT fall back to get_latest_completed_run() -- that would
    silently reintroduce exactly the "unrelated latest candidate" problem
    this change exists to close.

    Fallback behavior (all of these return (None, None), which callers
    already treat as "skip gates 7 and 9, no baseline invented" -- the same
    contract as before):
      - no manifest exists yet (still on the legacy bootstrap model, which
        has no known metrics) -> previousAccuracy: None
      - manifest exists but is corrupt/unreadable -> logged, treated as no
        baseline (never crashes retraining over a manifest problem)
      - manifest exists and is valid, but references a run id with no
        matching document in mltrainingruns -> logged clearly, baseline
        skipped for this run only (never silently substitutes some other
        run)

    Returns (previous_accuracy: float or None, previous_categories: list or None).
    """
    try:
        manifest = model_bundle.read_manifest()
    except model_bundle.ManifestError as exc:
        print(f"[background_retrain] warning: active.json is invalid, proceeding without a regression baseline: {exc}")
        return None, None

    if not manifest:
        # Still serving the legacy bootstrap model, which has no metrics to compare against.
        return None, None

    active_run_id = manifest.get("runId")
    if not active_run_id:
        return None, None

    try:
        active_run = runs.get_run(active_run_id)
    except Exception:
        print(f"[background_retrain] warning: could not fetch active manifest's run record for {run_id}; proceeding without one")
        return None, None

    if not active_run:
        print(
            f"[background_retrain] warning: active.json references run "
            f"{active_run_id}, which has no matching mltrainingruns document; "
            f"skipping regression comparison for this run only"
        )
        return None, None

    previous_metrics = active_run.get("metrics") or {}
    previous_accuracy = previous_metrics.get("accuracy")
    previous_categories = active_run.get("encoderClasses")

    return previous_accuracy, previous_categories


def _on_stage_complete(run_id, stage_name):
    """
    Phase D: stage_callback passed into run_retraining(). The only stage
    transition that needs a persisted status change here is "training"
    finishing -- that is the exact moment a candidate bundle exists but has
    not yet been validated, i.e. the run should now read "evaluating"
    rather than "running". The other three stages ("reservation",
    "snapshot", "validation") intentionally do not change status here:
    "reservation"/"snapshot" are still part of "running", and "validation"
    finishing is immediately followed by this function's caller deciding
    the run's actual terminal status (completed / failed_validation), so
    no separate status write is needed for it.

    Best-effort: a failure to write this transitional status must never
    abort an in-progress training run.
    """
    if stage_name != "training":
        return
    try:
        runs.mark_evaluating(run_id)
    except Exception:
        print(f"[background_retrain] warning: could not mark run {run_id} as evaluating")


def _rollback_reserved_feedback(run_id, reason):
    """
    Best-effort failure cleanup for feedback reservation (Phase C item 12):
    returns this run's "reserved" feedback back to "pending" so it can be
    retried by a future run. Never touches other runs' reservations,
    "trained" records, or "needs_review" records -- see
    db.feedback_repository.release_reserved_for_run for the exact filter.

    If this itself fails, it is logged clearly; reservation reconciliation
    (db.feedback_repository.reconcile_reserved_feedback, run at the next
    service startup or the next retrain's reservation stage) is the
    backstop that will recover this run's feedback once the run record is
    confirmed terminal (which it always is by the time this is called).
    """
    try:
        released = feedback.release_reserved_for_run(run_id, reason)
        if released:
            print(f"[background_retrain] released {released} feedback document(s) back to pending for run {run_id}")
    except Exception:
        print(
            f"[background_retrain] warning: failed to release reserved feedback "
            f"for run {run_id}; reservation reconciliation will recover it"
        )


def _rollback_manifest(previous_manifest):
    """
    Phase E activation-failure cleanup for the manifest file itself,
    called ONLY after write_manifest has already successfully published a
    new manifest and a LATER step (local snapshot swap, or the post-swap
    smoke test) then failed.

    - If a previous, valid manifest existed before this activation attempt
      started, it is re-published verbatim via another atomic
      write_manifest call -- restoring the exact previous pointer (same
      modelVersion/runId/generation/etc. it had before).
    - If no previous manifest existed (this was the very first activation
      attempt ever), there is nothing valid to restore -- the newly
      published manifest is instead removed via model_bundle.remove_manifest,
      returning the service to its pre-Phase-E "no manifest -> legacy
      model" state.

    Never touches any bundle directory's contents; never deletes the
    REJECTED candidate bundle (only the manifest FILE is touched here).

    Returns a small structured dict recording what happened, so the caller
    can attach it to the run's `activation` metadata for auditability.
    """
    if previous_manifest is not None:
        try:
            model_bundle.write_manifest(previous_manifest)
            log_event(
                "manifest_rolled_back", action="restored_previous_manifest", succeeded=True,
                modelVersion=previous_manifest.get("modelVersion"),
            )
            return {"action": "restored_previous_manifest", "succeeded": True}
        except Exception as exc:
            log_event(
                "manifest_rolled_back", level=50, action="restored_previous_manifest",
                succeeded=False, failureType=str(exc),
            )
            print(f"[background_retrain] CRITICAL: failed to restore previous manifest during rollback: {exc}")
            return {"action": "restored_previous_manifest", "succeeded": False, "error": str(exc)}
    else:
        removed = model_bundle.remove_manifest()
        log_event("manifest_rolled_back", action="removed_new_manifest", succeeded=removed)
        return {"action": "removed_new_manifest", "succeeded": removed}


def _attempt_activation(run_id, model_version, artifact_path, dataset_hash):
    """
    Phase E activation workflow -- called only after Phase D's validation
    has already succeeded for `run_id` (i.e. a publishable candidate
    exists). Implements the ordering the Phase E spec identifies as
    safest, and explains why:

        1. Load and validate the candidate into a local, not-yet-live
           snapshot (predictor_manager.preload_candidate). Nothing durable
           has happened yet -- if this fails, NOTHING external has
           changed: the manifest is untouched, this process's runtime is
           untouched. This is deliberately the FIRST step, before the
           manifest is ever touched, so that the manifest can never end up
           pointing at something this very process just proved it cannot
           load.
        2. Publish the manifest atomically (model_bundle.write_manifest).
           From this instant on, OTHER processes/workers that check the
           manifest could start trying to reload this candidate too (see
           predictor_manager.get_snapshot's lazy multi-worker check) --
           which is fine, because step 1 already proved at least THIS
           process can load it; other processes get their own independent
           preload+validate attempt via the same code path.
        3. Swap this process's own local snapshot to the (already
           validated) candidate.
        4. Run a post-swap smoke prediction as a final end-to-end
           confirmation using the now-live snapshot.
        5. Persist activation success onto the run record.
        6. Finalize this run's reserved feedback to "trained" -- ONLY now,
           after every previous step has actually succeeded.

    The required safety property ("the manifest must never point to a
    bundle the publishing process could not itself load and smoke-test")
    holds because step 1 always happens before step 2. The one residual
    risk window is between steps 2 and 4 (manifest published, but this
    process hasn't yet swapped/smoke-tested) -- if step 3 or 4 fails in
    that window, the rollback below restores the previous manifest AND the
    previous local snapshot before this function returns, so no window is
    ever left where the manifest points somewhere this process's own
    runtime disagrees with.

    Returns a structured dict:
        {"success": True,  "activation": {...}}
        {"success": False, "activation": {...}, "reason": "..."}

    Never raises -- every failure path inside this function is caught and
    turned into a structured failure result, since the caller
    (background_retrain) needs to reach its own mark_failed_activation /
    feedback-rollback logic regardless of exactly where activation failed.
    """
    try:
        previous_manifest = model_bundle.read_manifest()
    except model_bundle.ManifestError as exc:
        print(f"[background_retrain] warning: previous active.json was invalid before this activation attempt ({exc}); treating as no previous manifest")
        previous_manifest = None

    previous_model_version = (
        previous_manifest["modelVersion"] if previous_manifest else model_bundle.LEGACY_VERSION
    )
    next_generation = (previous_manifest.get("generation", 0) if previous_manifest else 0) + 1

    log_event(
        "activation_started", runId=run_id, modelVersion=model_version,
        manifestGeneration=next_generation,
    )
    runs.mark_activating(run_id, previous_model_version)

    # --- Step 1: preload + validate candidate, manifest/runtime untouched ---
    try:
        candidate_snapshot = predictor_manager.preload_candidate(
            model_version, run_id, next_generation
        )
    except ActivationError as exc:
        activation_metadata = {
            "passed": False, "loadedModelVersion": model_version,
            "manifestGeneration": next_generation, "failureReason": str(exc),
            "failedAtStage": "preload",
        }
        return {"success": False, "activation": activation_metadata, "reason": str(exc)}

    # --- Step 2: publish the manifest atomically -----------------------------
    new_manifest = model_bundle.build_manifest(
        model_version=model_version, run_id=run_id, artifact_path=artifact_path,
        dataset_hash=dataset_hash, previous_model_version=previous_model_version,
        generation=next_generation,
    )
    try:
        model_bundle.write_manifest(new_manifest)
        log_event(
            "manifest_published", runId=run_id, modelVersion=model_version,
            manifestGeneration=next_generation,
        )
    except Exception as exc:
        # write_manifest is temp-file + os.replace (all-or-nothing), so the old manifest is guaranteed untouched.
        activation_metadata = {
            "passed": False, "loadedModelVersion": model_version,
            "manifestGeneration": next_generation, "failureReason": str(exc),
            "failedAtStage": "publish_manifest",
        }
        return {"success": False, "activation": activation_metadata, "reason": str(exc)}

    # From here on the manifest IS published -- any failure needs a full rollback of manifest + runtime.
    previous_snapshot = predictor_manager.current_snapshot()

    try:
        predictor_manager.swap_in(candidate_snapshot)

        smoke_ok, smoke_reason = predictor_manager.smoke_test()
        if not smoke_ok:
            raise ActivationError(f"post-swap smoke test failed: {smoke_reason}")

    except Exception as exc:
        # Restore runtime first, then the manifest, so this process is never left serving an inconsistent snapshot.
        if previous_snapshot is not None:
            predictor_manager.swap_in(previous_snapshot)
        rollback_result = _rollback_manifest(previous_manifest)

        activation_metadata = {
            "passed": False, "loadedModelVersion": model_version,
            "manifestGeneration": next_generation, "failureReason": str(exc),
            "failedAtStage": "swap_or_smoke", "rollback": rollback_result,
        }
        return {"success": False, "activation": activation_metadata, "reason": str(exc)}

    # Fully activated: manifest published, local snapshot live, smoke test passed.
    activation_metadata = {
        "passed": True, "loadedModelVersion": model_version,
        "manifestGeneration": next_generation, "failureReason": None,
    }
    return {
        "success": True, "activation": activation_metadata,
        "manifestGeneration": next_generation, "publishedAt": new_manifest["publishedAt"],
    }


def background_retrain(run_id):
    """
    Runs in a background thread, only ever started by the request that
    successfully owns the MongoDB-backed lock for `run_id`.

    Persists queued -> running -> (completed | failed) on the run record,
    and ALWAYS releases the lock in a finally block. release_lock() itself
    is owner-checked (filtered on runId), so this can never release a lock
    that has since been reassigned to a newer run (e.g. after this run was
    judged stale and reclaimed).

    Phase E feedback policy (supersedes Phase C/D): reserved feedback is
    advanced to "trained" ONLY after a full, successful activation (see
    _attempt_activation) -- validation passing alone is no longer enough,
    because Phase D's "completed" only ever meant "publishable", never
    "live". On ANY failure at or before activation (training, validation,
    or activation itself), reserved feedback is rolled back to "pending"
    via _rollback_reserved_feedback. Once activation has fully succeeded,
    a LATER failure to finalize feedback (a MongoDB write error, say) is
    treated as a bookkeeping warning only -- it must never roll back an
    already-live model, and must never return that feedback to "pending"
    (the live model already includes it) -- see mark_bookkeeping_warning
    and this module's startup reconciliation.

    Status flow as of Phase E: "running" -> (after the training stage
    produces a candidate bundle) "evaluating" -> "failed_validation" (gates
    rejected the candidate) or "failed" (training itself broke, never
    reached "evaluating") or, on validation success, straight into
    "activating" -> "activated" (full activation succeeded) or
    "failed_activation" (activation itself failed at any of its steps).
    persist_model_candidate() is called once, whenever run_retraining
    returns model/metrics/validation data at all (even on a validation
    failure, since a rejected candidate's data is still worth recording for
    inspection) -- but never on a bare training-stage failure, where no
    candidate ever existed.

    Lock-release ordering (Phase E item 17): the lock is released in the
    outer `finally` below ONLY after this entire try block -- training,
    validation, AND the full activation workflow (manifest publication,
    local swap, smoke test, feedback finalization attempt) -- has reached
    its terminal outcome. This is deliberate: releasing the lock any
    earlier (e.g. right after validation) would let a second retrain start
    before this run's activation-or-rollback has finished, risking two
    runs racing to publish the manifest.

    Note on this threading model: this is still a single background Thread
    inside one process. The MongoDB-backed lock is what makes this safe
    across *multiple* processes/workers/replicas -- the thread itself
    remains a single-process, at-most-one-concurrent-training mechanism.
    """
    start_ts = time.monotonic()
    try:
        runs.mark_running(run_id)
        _heartbeat(run_id)
        log_event("retraining_started", runId=run_id)

        previous_accuracy, previous_categories = _fetch_baseline(run_id)

        result = run_retraining(
            run_id,
            previous_accuracy=previous_accuracy,
            previous_categories=previous_categories,
            heartbeat_callback=lambda: _heartbeat(run_id),
            stage_callback=lambda stage: _on_stage_complete(run_id, stage),
        )

        _attach_pipeline_bookkeeping(run_id, result)

        # One lifecycle log per stage actually reached, derived from the final result dict.
        if result.get("reservedFeedbackIds") is not None:
            log_event("feedback_reserved", runId=run_id,
                      feedbackCount=len(result.get("reservedFeedbackIds") or []))
        if result.get("datasetMetadata"):
            log_event("dataset_snapshot_created", runId=run_id,
                      datasetRows=(result["datasetMetadata"].get("rowCounts") or {}).get("total"))
        if result.get("modelVersion"):
            log_event("training_completed", runId=run_id, modelVersion=result.get("modelVersion"))
        if result.get("stage") == "validation" and not result.get("success"):
            log_event("validation_failed", level=30, runId=run_id,
                      modelVersion=result.get("modelVersion"), failureType=result.get("error"))
        elif result.get("success"):
            log_event("validation_passed", runId=run_id, modelVersion=result.get("modelVersion"))

        # Recorded whenever a candidate bundle was produced (modelVersion present), even if validation rejected it.
        if result.get("modelVersion"):
            try:
                runs.persist_model_candidate(
                    run_id,
                    model_version=result.get("modelVersion"),
                    metrics=result.get("metrics"),
                    validation_result=result.get("validation"),
                    artifact_path=result.get("artifactPath"),
                    encoder_classes=result.get("encoderClasses"),
                )
            except Exception:
                print(f"[background_retrain] warning: could not persist model candidate data for run {run_id}")

        if result.get("success"):
            # Validation succeeded -- attempt full activation; see _attempt_activation for rollback behavior.
            activation_result = _attempt_activation(
                run_id,
                model_version=result.get("modelVersion"),
                artifact_path=result.get("artifactPath"),
                dataset_hash=(result.get("datasetMetadata") or {}).get("sha256"),
            )

            if activation_result.get("success"):
                runs.mark_activated(
                    run_id,
                    activation_result["activation"],
                    activation_result["manifestGeneration"],
                    activation_result["publishedAt"],
                )
                log_event(
                    "activation_succeeded", runId=run_id,
                    modelVersion=result.get("modelVersion"),
                    manifestGeneration=activation_result["manifestGeneration"],
                    durationMs=int((time.monotonic() - start_ts) * 1000),
                )
                # Only point feedback advances to "trained"; a failure here is bookkeeping only -- model is live.
                try:
                    finalized = feedback.finalize_trained_for_run(run_id)
                    if finalized:
                        log_event("feedback_finalized", runId=run_id, feedbackCount=finalized)
                        print(f"[background_retrain] finalized {finalized} feedback document(s) to 'trained' for activated run {run_id}")
                except Exception as exc:
                    try:
                        runs.mark_bookkeeping_warning(run_id, str(exc))
                    except Exception:
                        pass
                    print(
                        f"[background_retrain] warning: run {run_id} is activated but feedback "
                        f"finalization failed ({exc}); reconciliation will finalize it later"
                    )

                # Best-effort, runs after activation/finalization are terminal, so a cleanup failure can't affect either.
                try:
                    model_cleanup.run_cleanup(
                        runs.get_run_for_model_version, runs.find_runs_by_status, dry_run=False
                    )
                except Exception as exc:
                    print(f"[background_retrain] warning: post-activation cleanup failed: {exc}")
            else:
                # Any failure before a successful activation returns reservations to "pending" -- nothing switched.
                reason = activation_result.get("reason") or "Activation failed"
                log_event(
                    "activation_failed", level=40, runId=run_id,
                    modelVersion=result.get("modelVersion"), failureType=reason,
                    durationMs=int((time.monotonic() - start_ts) * 1000),
                )
                runs.mark_failed_activation(run_id, reason, activation_result.get("activation"))
                _rollback_reserved_feedback(run_id, reason)
        elif result.get("stage") == "validation":
            reason = result.get("error") or "Validation failed"
            runs.mark_failed_validation(run_id, reason)
            _rollback_reserved_feedback(run_id, reason)
        else:
            reason = result.get("error") or "Retraining failed"
            runs.mark_failed(run_id, reason)
            _rollback_reserved_feedback(run_id, reason)

    except Exception as exc:
        reason = str(exc)
        try:
            runs.mark_failed(run_id, reason)
        except Exception:
            # Cannot even record the failure; startup reconciliation is the backstop.
            pass
        _rollback_reserved_feedback(run_id, reason)

    finally:
        try:
            runs.release_lock(run_id)
        except Exception:
            pass


def _fail_and_release(run_id, reason):
    """
    Best-effort terminal cleanup for a run that must not be left "queued" or
    holding the lock, used on failure paths that occur BEFORE the background
    thread exists to do this itself in its own finally block (i.e. the two
    failure windows this hardening pass closes: a claim/reclaim exception,
    and a thread-construction/start failure).

    release_lock() is owner-checked and a safe no-op if this run never
    actually held the lock, so it is always safe to call unconditionally
    here regardless of exactly how far the caller got before failing.
    """
    try:
        runs.fail_unstarted_run(run_id, reason)
    except Exception:
        pass
    try:
        runs.release_lock(run_id)
    except Exception:
        pass


def _cleanup_unclaimed(run_id):
    """
    Best-effort cleanup for an attempt that lost a genuine claim race
    (peek_active_run() reported the lock as free, but a concurrent request
    won the atomic claim first). Per Phase B.1 policy this is not a failure
    of the system, so the bookkeeping document is removed rather than kept
    as a misleading "failed" record. If the delete itself fails, falls back
    to marking the run failed so it is, at minimum, never left "queued".
    """
    try:
        runs.abandon_unclaimed_run(run_id)
    except Exception:
        try:
            runs.fail_unstarted_run(run_id, "lock claim lost to a concurrent request")
        except Exception:
            pass


def _service_unavailable():
    # Deliberately generic -- never include MongoDB credentials or raw internal stack traces in a response.
    return HTTPException(
        status_code=503,
        detail="Retraining service is temporarily unavailable."
    )


@app.post("/retrain-model")
def retrain_model(
    payload: Optional[RetrainTriggerRequest] = None,
    x_ml_operations_token: Optional[str] = Header(None),
):
    """
    Remediation Workstream C -- this is the most consequential of the three
    previously-unauthenticated endpoints (it starts a real background
    retraining run, and had NO authentication at all before this fix). Same
    fail-closed shared-secret guard as /predict-category and
    /generate-description; see _require_operations_token's own doc comment.
    Checked FIRST, before the active-run fast path, the persistent run
    record, or the lock claim -- a rejected caller creates no TrainingRun
    document and starts no background thread.
    """
    _require_operations_token(x_ml_operations_token)

    requested_source = payload.source if payload else None

    # --- Fast path: a live run is already active -> create no record at all
    try:
        active_run_id = runs.peek_active_run(STALE_RUN_TIMEOUT_SECONDS)
    except Exception:
        raise _service_unavailable()

    if active_run_id:
        active_run = runs.get_run(active_run_id)
        return JSONResponse(
            status_code=200,
            content={
                "success": True,
                "runId": active_run_id,
                "status": (active_run or {}).get("status", "running"),
                "existingRun": True,
                "message": "Retraining is already in progress"
            }
        )

    # --- Create the persistent record for this attempt ---------------------
    try:
        run_id = runs.create_run(requested_source)
    except Exception:
        raise _service_unavailable()

    log_event("retraining_requested", runId=run_id, trigger=requested_source or "manual")

    # Any failure here means run_id must be resolved to terminal and the lock released -- never left dangling.
    try:
        claimed, stale_run_id = runs.claim_or_reclaim(run_id, STALE_RUN_TIMEOUT_SECONDS)
    except Exception:
        _fail_and_release(run_id, "database error during lock claim")
        raise _service_unavailable()

    if stale_run_id:
        try:
            runs.fail_unstarted_run(stale_run_id, "stale training run recovered")
        except Exception:
            # The reclaim itself already succeeded; failing to mark the old run failed must not abandon our lock.
            print(
                f"[retrain-model] warning: could not mark stale run "
                f"{stale_run_id} as failed after its lock was reclaimed by {run_id}"
            )

    if not claimed:
        # Lost a genuine race to the atomic claim -- not persisted as a misleading "failed" record.
        _cleanup_unclaimed(run_id)

        try:
            current_lock = runs.get_active_lock() or {}
            active_run_id = current_lock.get("runId")
            active_run = runs.get_run(active_run_id) if active_run_id else None
        except Exception:
            raise _service_unavailable()

        return JSONResponse(
            status_code=200,
            content={
                "success": True,
                "runId": active_run_id,
                "status": (active_run or {}).get("status", "running"),
                "existingRun": True,
                "message": "Retraining is already in progress"
            }
        )

    # --- We own the lock for run_id -- start background execution ----------
    try:
        Thread(
            target=background_retrain,
            args=(run_id,),
            daemon=True
        ).start()
    except Exception:
        _fail_and_release(run_id, "failed to start retraining worker")
        raise _service_unavailable()

    return JSONResponse(
        status_code=202,
        content={
            "success": True,
            "runId": run_id,
            "status": "queued",
            "existingRun": False,
            "message": "Retraining accepted"
        }
    )
