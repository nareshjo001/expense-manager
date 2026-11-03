"""Operational status API support (Phase F). py as it already was before this phase."""

import os
import secrets
import datetime

from training import model_bundle
from db import training_run_repository as runs
from observability import sanitize_reason

# Stable field set for the DETAIL view; anything else on the underlying Mongo document is never exposed.
RUN_DETAIL_FIELDS = (
    "runId", "status", "trigger", "createdAt", "startedAt", "completedAt",
    "heartbeatAt", "failureReason", "bookkeepingWarning", "modelVersion",
    "manifestGeneration", "datasetHash", "rowCounts", "metrics", "validation",
    "activation",
)

# Smaller field set for the LIST view -- enough to triage a run without a full gate dump per item.
RUN_SUMMARY_FIELDS = (
    "runId", "status", "trigger", "createdAt", "completedAt",
    "modelVersion", "failureReason",
)


def _isoformat(value):
    """Safely converts a datetime to an ISO-8601 string; passes through anything that isn't a datetime (None, or an already-string value) unchanged."""
    if isinstance(value, datetime.datetime):
        return value.isoformat() + ("Z" if value.tzinfo is None else "")
    return value


_DATETIME_FIELDS = {"createdAt", "startedAt", "completedAt", "heartbeatAt"}


def _sanitize_run_dict(run, allowed_fields):
    """) down to exactly `allowed_fields`, converts datetimes to ISO strings, and sanitizes the one free-text field (failureReason) that could ever contain exception-derived text."""
    if run is None:
        return None

    out = {}
    for field in allowed_fields:
        value = run.get(field)
        if field in _DATETIME_FIELDS:
            value = _isoformat(value)
        elif field == "failureReason":
            value = sanitize_reason(value)
        elif field == "bookkeepingWarning":
            value = sanitize_reason(value)
        out[field] = value

    return out


def serialize_run_summary(run):
    return _sanitize_run_dict(run, RUN_SUMMARY_FIELDS)


def serialize_run_detail(run):
    return _sanitize_run_dict(run, RUN_DETAIL_FIELDS)


# Training-run detail / list assembly
def get_run_detail(run_id):
    """Get_run already treats a malformed id as "not found" rather than raising) -- the route layer turns None into a 404."""
    run = runs.get_run(run_id)
    if run is None:
        return None
    return serialize_run_detail(run)


def list_runs_response(limit=20, status=None, before=None):
    """List_runs for the exact validation."""
    items, next_cursor = runs.list_runs(limit=limit, status=status, before=before)
    summaries = [serialize_run_summary(r) for r in items]
    return {
        "items": summaries,
        "count": len(summaries),
        "nextCursor": next_cursor,
    }


# /ml-status
def build_ml_status(predictor_manager):
    """Assembles the GET /ml-status response."""
    metadata = predictor_manager.current_snapshot_metadata()
    diagnostics = predictor_manager.diagnostics()

    manifest = None
    manifest_error = None
    try:
        manifest = model_bundle.read_manifest()
    except model_bundle.ManifestError as exc:
        manifest_error = sanitize_reason(str(exc))

    if metadata:
        runtime = {
            "ready": True,
            "modelVersion": metadata["modelVersion"],
            "runId": metadata["runId"],
            "loadedAt": metadata["loadedAt"],
            "manifestGeneration": metadata["manifestGeneration"],
            "source": (
                "legacy-fixed" if metadata["modelVersion"] == model_bundle.LEGACY_VERSION
                else "versioned-bundle"
            ),
        }
    else:
        runtime = {
            "ready": False, "modelVersion": None, "runId": None,
            "loadedAt": None, "manifestGeneration": None, "source": None,
        }

    active_manifest = None
    if manifest:
        active_manifest = {
            "modelVersion": manifest.get("modelVersion"),
            "runId": manifest.get("runId"),
            "generation": manifest.get("generation"),
            "publishedAt": manifest.get("publishedAt"),
        }

    if manifest is None:
        # No manifest yet -- synchronized iff still correctly serving the legacy bootstrap model.
        synchronized = bool(metadata) and metadata["modelVersion"] == model_bundle.LEGACY_VERSION
    else:
        synchronized = (
            bool(metadata)
            and metadata["modelVersion"] == manifest.get("modelVersion")
            and metadata["manifestGeneration"] == manifest.get("generation")
        )

    last_reload_error = diagnostics.get("lastReloadError") or manifest_error

    return {
        "runtime": runtime,
        "activeManifest": active_manifest,
        "synchronized": synchronized,
        "lastReloadError": last_reload_error,
        "reloadDiagnostics": {
            "lastManifestCheckAt": diagnostics.get("lastManifestCheckAt"),
            "lastReloadAttemptAt": diagnostics.get("lastReloadAttemptAt"),
            "lastReloadSuccessAt": diagnostics.get("lastReloadSuccessAt"),
            "lastReloadErrorAt": diagnostics.get("lastReloadErrorAt"),
            "reloadFailureCount": diagnostics.get("reloadFailureCount"),
        },
    }


# Liveness / readiness
def build_liveness():
    """GET /health/live semantics: "is this process able to serve HTTP at all"."""
    return {"status": "alive"}


def build_readiness(predictor_manager):
    """GET /health/ready semantics: "can this process currently serve valid predictions"."""
    snapshot = predictor_manager.current_snapshot()
    if snapshot is None:
        return False, {"ready": False, "reason": "no runtime snapshot loaded"}

    if snapshot.model is None or snapshot.vectorizer is None or snapshot.labelEncoder is None:
        return False, {"ready": False, "reason": "runtime snapshot is incomplete"}

    ok, reason = predictor_manager.smoke_test()
    if not ok:
        return False, {"ready": False, "reason": sanitize_reason(reason)}

    return True, {"ready": True, "modelVersion": snapshot.modelVersion}


# Shared-secret access control: gates /ml-status and /training-runs*; health endpoints stay open for probes.
OPERATIONS_TOKEN_HEADER = "X-ML-Operations-Token"


def operations_token_configured():
    return bool(os.getenv("ML_OPERATIONS_TOKEN"))


def check_operations_token(provided_token):
    """Fail-closed by construction: if ML_OPERATIONS_TOKEN is not configured at all, this ALWAYS returns False -- there is no "operational endpoints are open by default" fallback."""
    configured = os.getenv("ML_OPERATIONS_TOKEN")
    if not configured:
        return False
    if not provided_token:
        return False
    return secrets.compare_digest(provided_token, configured)
