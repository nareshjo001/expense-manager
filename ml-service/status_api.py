"""
Operational status API support (Phase F).

Owns:
  - serialization of MongoDB training-run documents into sanitized,
    stable-shaped API responses (status_api item 16 -- "one serialization
    layer for run/status API output", never a raw document dump)
  - assembly of the /ml-status snapshot (runtime + manifest + sync state)
  - liveness/readiness semantics
  - the shared-secret operational-token check (Phase F item 7)

Deliberately has NO dependency on FastAPI -- this module returns plain
dicts/tuples/booleans; app.py's route handlers are the only place that
translates a failure here into an HTTPException, keeping the FastAPI
dependency confined to app.py as it already was before this phase.
"""

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
    """Safely converts a datetime to an ISO-8601 string; passes through
    anything that isn't a datetime (None, or an already-string value)
    unchanged. Centralizing this is what item 16 calls "convert ObjectId
    and datetime values safely" -- ObjectId is already converted to a
    plain string by db.training_run_repository._serialize_run, so this
    module only needs to handle datetimes."""
    if isinstance(value, datetime.datetime):
        return value.isoformat() + ("Z" if value.tzinfo is None else "")
    return value


_DATETIME_FIELDS = {"createdAt", "startedAt", "completedAt", "heartbeatAt"}


def _sanitize_run_dict(run, allowed_fields):
    """
    Shared core of serialize_run_summary/serialize_run_detail: projects
    `run` (the dict already returned by
    db.training_run_repository._serialize_run, via get_run/list_runs/etc.)
    down to exactly `allowed_fields`, converts datetimes to ISO strings,
    and sanitizes the one free-text field (failureReason) that could ever
    contain exception-derived text. Tolerates missing keys from older run
    documents (pre-Phase-D/E documents won't have modelVersion/activation/
    etc. at all) by defaulting to None rather than raising KeyError.
    """
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
    """
    Returns a sanitized detail dict for `run_id`, or None if the run does
    not exist / run_id is malformed (db.training_run_repository.get_run
    already treats a malformed id as "not found" rather than raising) --
    the route layer turns None into a 404.
    """
    run = runs.get_run(run_id)
    if run is None:
        return None
    return serialize_run_detail(run)


def list_runs_response(limit=20, status=None, before=None):
    """
    Returns the full /training-runs response body:
        {"items": [...], "count": N, "nextCursor": "..." or None}

    Raises ValueError (translated by the route layer into a 400) for an
    unrecognized status filter or malformed cursor -- see
    db.training_run_repository.list_runs for the exact validation.
    """
    items, next_cursor = runs.list_runs(limit=limit, status=status, before=before)
    summaries = [serialize_run_summary(r) for r in items]
    return {
        "items": summaries,
        "count": len(summaries),
        "nextCursor": next_cursor,
    }


# /ml-status
def build_ml_status(predictor_manager):
    """
    Assembles the GET /ml-status response.

    Deliberately READ-ONLY: `predictor_manager.current_snapshot_metadata()`
    and `.diagnostics()` only read already-in-memory state, and
    `model_bundle.read_manifest()` only reads the manifest FILE -- neither
    call triggers a reload, a bundle load, or any write, satisfying the
    Phase F requirement that calling this endpoint must never itself cause
    a reload.
    """
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
    """
    GET /health/live semantics: "is this process able to serve HTTP at
    all". Deliberately does NOT touch MongoDB or the predictor manager --
    a database outage or a bad model must never make this report unhealthy
    (that is what readiness is for); liveness only answers "is the process
    itself alive and not deadlocked", which is trivially true if this
    function is running at all.
    """
    return {"status": "alive"}


def build_readiness(predictor_manager):
    """
    GET /health/ready semantics: "can this process currently serve valid
    predictions". Checks:
      1. a runtime snapshot exists at all
      2. its model/vectorizer/labelEncoder objects are present (structural
         consistency -- catches a snapshot that was somehow only
         partially constructed, though RuntimeSnapshot's own constructor
         already makes this practically unreachable)
      3. a lightweight end-to-end smoke prediction succeeds, via
         predictor_manager.smoke_test() -- which only exercises the
         already-loaded in-memory objects (vectorizer.transform ->
         model.predict -> encoder.inverse_transform on a few fixed
         strings); it does NOT read the manifest, does NOT touch disk,
         and does NOT reload/replace the snapshot, so this is cheap
         enough to run on every readiness probe without violating "do not
         perform expensive bundle reloads on every readiness request".

    Returns (ready: bool, body: dict). The route layer maps `ready` to the
    HTTP status code (200 vs a non-2xx).
    """
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
    """
    Fail-closed by construction: if ML_OPERATIONS_TOKEN is not configured
    at all, this ALWAYS returns False -- there is no "operational
    endpoints are open by default" fallback. A missing/empty
    `provided_token` also always fails, even if a real token is
    configured. A real, configured token is compared using
    `secrets.compare_digest` (constant-time), never `==`, to avoid a
    timing side-channel on the comparison itself.

    Never logs the token value, provided or configured -- callers must
    not either.
    """
    configured = os.getenv("ML_OPERATIONS_TOKEN")
    if not configured:
        return False
    if not provided_token:
        return False
    return secrets.compare_digest(provided_token, configured)
