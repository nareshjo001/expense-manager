import os
import re
import time
import uuid
from threading import Thread
from typing import Optional

from fastapi import FastAPI, HTTPException, Response, Header, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

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

# Request/correlation ID propagation.
REQUEST_ID_HEADER = "X-Request-ID"
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,128}$")


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    incoming = request.headers.get(REQUEST_ID_HEADER, "").strip()
    request_id = incoming if REQUEST_ID_PATTERN.match(incoming) else str(uuid.uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers[REQUEST_ID_HEADER] = request_id
    return response

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


class ApprovalDecisionRequest(BaseModel):
    # ML-001-T06 -- optional free-text operator note, recorded on the run
    # document by /training-runs/{run_id}/reject. Never required.
    reason: Optional[str] = None


@app.on_event("startup")
def validate_configuration_on_startup():
    """Phase G item 10: centralized startup configuration validation."""
    result = ml_config.run_and_log_startup_validation()
    if result["errors"]:
        raise ml_config.ConfigurationError(
            "Fatal ml-service configuration problem(s): " + "; ".join(result["errors"])
        )


@app.on_event("startup")
def initialize_predictor_on_startup():
    """Registered BEFORE the reconciliation handler below (FastAPI runs startup handlers in registration order), so this process has a usable RuntimeSnapshot before any activation-related reconciliation logic (which itself may need to preload/swap a candidate) ever runs."""
    predictor_manager.initialize()


# Most recent startup reconciliation summary, kept in memory only so a caller can inspect the last pass.
_last_reconciliation_summary = None


@app.on_event("startup")
def ensure_indexes_on_startup():
    """Ensure_indexes). Registered before the reconciliation handler purely so indexes exist before reconciliation's own queries run, though neithe."""
    try:
        runs.ensure_indexes()
    except Exception as exc:
        print(f"[startup] warning: index creation skipped ({type(exc).__name__}: {exc})")


@app.on_event("startup")
def reconcile_training_runs_on_startup():
    """Startup reconciliation. Phase F extends this to RETURN (and log, as a single summarized event) a structured count breakdown instead of only."""
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
    """Cheap, read-only check of whether a manifest's referenced bundle is complete and internally consistent enough to be worth attempting a real preload -- NOT a substitute for predictor_manager's own full runtime validation (feature/encoder compatibility, smoke prediction), which is what actually decides whether the candidate can be trusted; this is just a fast pre-filter to avoid attempting a load for an obviously-incomplete bundle."""
    if manifest is None:
        return False
    return model_bundle.is_bundle_complete(manifest["modelVersion"])


def _reconcile_activating_run(run, manifest):
    """E. the process that started activating it crashed or was killed before recording a terminal activation outcome)."""
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
    """1/C/D sweeps know nothing about (they are entirely unaware of the manifest file): 1."""
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
    """Shared guard for the three operational endpoints (Phase F item 7, shared-secret policy)."""
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
    """Phase F liveness probe: "is this process able to serve HTTP at all"."""
    return status_api.build_liveness()


@app.get("/health/ready")
def health_ready():
    """Phase F readiness probe: "can this process currently serve valid predictions"."""
    ready, body = status_api.build_readiness(predictor_manager)
    if not ready:
        return JSONResponse(status_code=503, content=body)
    return JSONResponse(status_code=200, content=body)


@app.get("/ml-status")
def ml_status(x_ml_operations_token: Optional[str] = Header(None)):
    """Build_ml_status for the exact contract. Protected by the shared-secret operations token (see _require_operations_token)."""
    _require_operations_token(x_ml_operations_token)
    return status_api.build_ml_status(predictor_manager)


@app.get("/training-runs/{run_id}")
def training_run_detail(run_id: str, x_ml_operations_token: Optional[str] = Header(None)):
    """Sanitized single-run detail view."""
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
    """List_runs for the exact bounds (limit clamped to [1, 100], default 20) and cursor semantics."""
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
    """Remediation Workstream C -- this endpoint previously had NO authentication at all, unlike /ml-status and /training-runs* (which have always required the shared-secret operations token)."""
    _require_operations_token(x_ml_operations_token)
    return predict_category(
        data.expenseName
    )


@app.post("/generate-description")
def generate_description_api(
    data: DescriptionRequest,
    x_ml_operations_token: Optional[str] = Header(None),
):
    """Remediation Workstream C -- same fail-closed operations-token guard as /predict-category above; see that endpoint's doc comment for the full rationale."""
    _require_operations_token(x_ml_operations_token)
    return generate_description_response(
        expense_name=data.expenseName,
        category=data.expenseCategory,
        amount=data.expenseAmount
    )
def _heartbeat(run_id):
    """Best-effort heartbeat update passed into run_retraining() as its stage callback."""
    try:
        runs.update_heartbeat(run_id)
    except Exception:
        pass


def _attach_pipeline_bookkeeping(run_id, result):
    """Best-effort persistence of Phase C dataset/reservation bookkeeping onto the run record."""
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
    """Baseline source changed from "the latest completed/validated run" (Phase D) to "the run that is actually PUBLISHED/ACTIVATED right now" (per the Phase E spec's item 15 -- the regression baseline must represent current LIVE behavior, not merely the latest experiment, which could be a candidate that was never activated, or that lost a race to a different run's activation)."""
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
    """Stage_callback passed into run_retraining(). e."""
    if stage_name != "training":
        return
    try:
        runs.mark_evaluating(run_id)
    except Exception:
        print(f"[background_retrain] warning: could not mark run {run_id} as evaluating")


def _rollback_reserved_feedback(run_id, reason):
    """Best-effort failure cleanup for feedback reservation (Phase C item 12): returns this run's "reserved" feedback back to "pending" so it can be retried by a future run."""
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
    """Phase E activation-failure cleanup for the manifest file itself, called ONLY after write_manifest has already successfully published a new manifest and a LATER step (local snapshot swap, or the post-swap smoke test) then failed."""
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
    """E. a publishable candidate exists)."""
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
    """Runs in a background thread, only ever started by the request that successfully owns the MongoDB-backed lock for `run_id`."""
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
            if ml_config.is_manual_approval_required():
                # T06 manual promotion gate: pause here instead of activating automatically.
                runs.mark_awaiting_approval(run_id)
                log_event(
                    "awaiting_manual_approval", runId=run_id,
                    modelVersion=result.get("modelVersion"),
                    durationMs=int((time.monotonic() - start_ts) * 1000),
                )
            else:
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
    """E. the two failure windows this hardening pass closes: a claim/reclaim exception, and a thread-construction/start failure)."""
    try:
        runs.fail_unstarted_run(run_id, reason)
    except Exception:
        pass
    try:
        runs.release_lock(run_id)
    except Exception:
        pass


def _cleanup_unclaimed(run_id):
    """Best-effort cleanup for an attempt that lost a genuine claim race (peek_active_run() reported the lock as free, but a concurrent request won the atomic claim first)."""
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
    """Remediation Workstream C -- this is the most consequential of the three previously-unauthenticated endpoints (it starts a real background retraining run, and had NO authentication at all before this fix)."""
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


@app.post("/training-runs/{run_id}/approve")
def approve_training_run(run_id: str, x_ml_operations_token: Optional[str] = Header(None)):
    """Is_manual_approval_required() left a run sitting at "awaiting_approval" instead of activating it automatically."""
    _require_operations_token(x_ml_operations_token)

    run_doc = runs.get_run(run_id)
    if run_doc is None:
        raise HTTPException(status_code=404, detail="No such training run.")
    if run_doc.get("status") != "awaiting_approval":
        raise HTTPException(
            status_code=409,
            detail=f"Training run {run_id} is not awaiting approval (status: {run_doc.get('status')}).",
        )

    activation_result = _attempt_activation(
        run_id,
        model_version=run_doc.get("modelVersion"),
        artifact_path=run_doc.get("artifactPath"),
        dataset_hash=run_doc.get("datasetHash"),
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
            modelVersion=run_doc.get("modelVersion"),
            manifestGeneration=activation_result["manifestGeneration"],
            trigger="manual_approval",
        )
        # Only point feedback advances to "trained"; a failure here is bookkeeping only -- model is live.
        try:
            finalized = feedback.finalize_trained_for_run(run_id)
            if finalized:
                log_event("feedback_finalized", runId=run_id, feedbackCount=finalized)
                print(f"[approve_training_run] finalized {finalized} feedback document(s) to 'trained' for activated run {run_id}")
        except Exception as exc:
            try:
                runs.mark_bookkeeping_warning(run_id, str(exc))
            except Exception:
                pass
            print(
                f"[approve_training_run] warning: run {run_id} is activated but feedback "
                f"finalization failed ({exc}); reconciliation will finalize it later"
            )

        # Best-effort, runs after activation/finalization are terminal, so a cleanup failure can't affect either.
        try:
            model_cleanup.run_cleanup(
                runs.get_run_for_model_version, runs.find_runs_by_status, dry_run=False
            )
        except Exception as exc:
            print(f"[approve_training_run] warning: post-activation cleanup failed: {exc}")

        return JSONResponse(
            status_code=200,
            content={
                "success": True,
                "runId": run_id,
                "status": "activated",
                "modelVersion": run_doc.get("modelVersion"),
                "manifestGeneration": activation_result["manifestGeneration"],
            }
        )

    # Any failure before a successful activation returns reservations to "pending" -- nothing switched.
    reason = activation_result.get("reason") or "Activation failed"
    log_event(
        "activation_failed", level=40, runId=run_id,
        modelVersion=run_doc.get("modelVersion"), failureType=reason,
        trigger="manual_approval",
    )
    runs.mark_failed_activation(run_id, reason, activation_result.get("activation"))
    _rollback_reserved_feedback(run_id, reason)
    raise HTTPException(
        status_code=422,
        detail=sanitize_reason(reason, max_length=500),
    )


@app.post("/training-runs/{run_id}/reject")
def reject_training_run(
    run_id: str,
    payload: Optional[ApprovalDecisionRequest] = None,
    x_ml_operations_token: Optional[str] = Header(None),
):
    """T06 manual promotion gate -- records that a human explicitly declined to promote a candidate sitting at "awaiting_approval"."""
    _require_operations_token(x_ml_operations_token)

    run_doc = runs.get_run(run_id)
    if run_doc is None:
        raise HTTPException(status_code=404, detail="No such training run.")
    if run_doc.get("status") != "awaiting_approval":
        raise HTTPException(
            status_code=409,
            detail=f"Training run {run_id} is not awaiting approval (status: {run_doc.get('status')}).",
        )

    reason = payload.reason if payload else None
    runs.mark_rejected(run_id, reason)
    log_event("candidate_rejected", runId=run_id, modelVersion=run_doc.get("modelVersion"))

    return JSONResponse(
        status_code=200,
        content={
            "success": True,
            "runId": run_id,
            "status": "rejected",
            "modelVersion": run_doc.get("modelVersion"),
        }
    )
