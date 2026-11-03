"""1). The single place that issues raw MongoDB queries for the retraining lifecycle."""

import datetime

from bson import ObjectId
from bson.errors import InvalidId
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from db.mongo import get_db

RUNS_COLLECTION = "mltrainingruns"
LOCKS_COLLECTION = "mltraininglocks"

# Well-known singleton lock document id, kept in its own collection separate from ordinary run records.
LOCK_ID = "training_lock"

ALLOWED_STATUSES = {
    "queued", "running", "evaluating", "completed", "failed", "failed_validation",
    "activating", "activated", "failed_activation",
    # Py's background_retrain).
    "awaiting_approval", "rejected",
}
ALLOWED_TRIGGER_SOURCES = {"cron", "manual", "api"}


def _utcnow():
    return datetime.datetime.utcnow()


def _runs():
    return get_db()[RUNS_COLLECTION]


def _locks():
    return get_db()[LOCKS_COLLECTION]


def _serialize_run(doc):
    if not doc:
        return None
    return {
        "runId": str(doc["_id"]),
        "status": doc.get("status"),
        "trigger": doc.get("trigger"),
        "createdAt": doc.get("createdAt"),
        "startedAt": doc.get("startedAt"),
        "completedAt": doc.get("completedAt"),
        "heartbeatAt": doc.get("heartbeatAt"),
        "failureReason": doc.get("failureReason"),
        # None until persist_model_candidate() runs; describes the CANDIDATE bundle, never the live predictor.
        "modelVersion": doc.get("modelVersion"),
        "metrics": doc.get("metrics"),
        "validation": doc.get("validation"),
        "artifactPath": doc.get("artifactPath"),
        "encoderClasses": doc.get("encoderClasses"),
        # None until this run reaches (or attempts) activation.
        "publishedAt": doc.get("publishedAt"),
        "activatedAt": doc.get("activatedAt"),
        "previousModelVersion": doc.get("previousModelVersion"),
        "manifestGeneration": doc.get("manifestGeneration"),
        "activation": doc.get("activation"),
        "bookkeepingWarning": doc.get("bookkeepingWarning"),
        # Set by attach_dataset_metadata; exposed for the run-detail API.
        "datasetHash": doc.get("datasetHash"),
        "rowCounts": doc.get("rowCounts"),
        # ML-001-T06 -- set only by mark_rejected, on a run a human declined to promote.
        "rejectionReason": doc.get("rejectionReason"),
    }


def resolve_trigger_source(requested_source):
    """Never trust an arbitrary client-supplied trigger value directly."""
    if requested_source in ALLOWED_TRIGGER_SOURCES:
        return requested_source
    return "api"


# Training-run records
def create_run(requested_trigger_source=None):
    """Create a new run record in "queued" status. py)."""
    now = _utcnow()
    doc = {
        "status": "queued",
        "trigger": {"source": resolve_trigger_source(requested_trigger_source)},
        "createdAt": now,
        "startedAt": None,
        "completedAt": None,
        "heartbeatAt": now,
        "failureReason": None,
    }
    result = _runs().insert_one(doc)
    return str(result.inserted_id)


def get_run(run_id):
    """Return a serialized run document, or None if run_id is missing/invalid."""
    if not run_id:
        return None
    try:
        object_id = ObjectId(run_id)
    except (InvalidId, TypeError):
        return None
    return _serialize_run(_runs().find_one({"_id": object_id}))


def mark_running(run_id):
    now = _utcnow()
    _runs().update_one(
        {"_id": ObjectId(run_id)},
        {"$set": {"status": "running", "startedAt": now, "heartbeatAt": now}}
    )


def update_heartbeat(run_id):
    """Py's heartbeat_callback)."""
    _runs().update_one(
        {"_id": ObjectId(run_id)},
        {"$set": {"heartbeatAt": _utcnow()}}
    )


def mark_completed(run_id):
    now = _utcnow()
    _runs().update_one(
        {"_id": ObjectId(run_id)},
        {"$set": {"status": "completed", "completedAt": now, "heartbeatAt": now}}
    )


def mark_failed(run_id, reason):
    """General-purpose terminal-failure primitive: sets status, completedAt, and a sanitized (length-capped, never-empty) failureReason, regardless of the run's current status."""
    now = _utcnow()
    _runs().update_one(
        {"_id": ObjectId(run_id)},
        {
            "$set": {
                "status": "failed",
                "completedAt": now,
                "heartbeatAt": now,
                "failureReason": (str(reason)[:2000] if reason else "Unknown failure"),
            }
        }
    )


def mark_evaluating(run_id):
    """Py is about to be invoked. g."""
    _runs().update_one(
        {"_id": ObjectId(run_id)},
        {"$set": {"status": "evaluating", "heartbeatAt": _utcnow()}}
    )


def mark_failed_validation(run_id, reason):
    """Terminal failure specifically for "training succeeded, but the candidate bundle did not pass validation" -- distinct from mark_failed's "failed" status, which means training itself broke before a candidate bundle could even be produced."""
    now = _utcnow()
    _runs().update_one(
        {"_id": ObjectId(run_id)},
        {
            "$set": {
                "status": "failed_validation",
                "completedAt": now,
                "heartbeatAt": now,
                "failureReason": (str(reason)[:2000] if reason else "Validation failed"),
            }
        }
    )


def mark_activating(run_id, previous_model_version):
    """Transition a run from "evaluating" (validation just passed) to "activating" -- the run now has a publishable candidate and the background workflow is about to attempt runtime activation (preload, manifest publication, local snapshot swap, post-swap smoke test)."""
    _runs().update_one(
        {"_id": ObjectId(run_id)},
        {
            "$set": {
                "status": "activating",
                "heartbeatAt": _utcnow(),
                "previousModelVersion": previous_model_version,
            }
        }
    )


def mark_activated(run_id, activation_metadata, manifest_generation, published_at):
    """Terminal SUCCESS status. json points at it) AND the publishing process itself successfully loaded it and passed a post-swap smoke prediction."""
    now = _utcnow()
    _runs().update_one(
        {"_id": ObjectId(run_id)},
        {
            "$set": {
                "status": "activated",
                "completedAt": now,
                "activatedAt": now,
                "publishedAt": published_at,
                "manifestGeneration": manifest_generation,
                "heartbeatAt": now,
                "activation": activation_metadata,
            }
        }
    )


def mark_failed_activation(run_id, reason, activation_metadata=None):
    """Terminal failure specifically for "training and validation both succeeded, but something in the activation workflow itself failed" -- runtime load failure, manifest publication failure, or a post-swap smoke-test failure (even after a successful rollback of the manifest/runtime)."""
    now = _utcnow()
    update = {
        "status": "failed_activation",
        "completedAt": now,
        "heartbeatAt": now,
        "failureReason": (str(reason)[:2000] if reason else "Activation failed"),
    }
    if activation_metadata is not None:
        update["activation"] = activation_metadata
    _runs().update_one({"_id": ObjectId(run_id)}, {"$set": update})


def mark_awaiting_approval(run_id):
    """Py's background_retrain)."""
    _runs().update_one(
        {"_id": ObjectId(run_id)},
        {"$set": {"status": "awaiting_approval", "heartbeatAt": _utcnow()}}
    )


def mark_rejected(run_id, reason=None):
    """Terminal status recording that a human explicitly declined to promote a candidate that was "awaiting_approval"."""
    now = _utcnow()
    _runs().update_one(
        {"_id": ObjectId(run_id)},
        {
            "$set": {
                "status": "rejected",
                "completedAt": now,
                "heartbeatAt": now,
                "rejectionReason": (str(reason)[:2000] if reason else None),
            }
        }
    )


def mark_bookkeeping_warning(run_id, warning):
    """G. a transient MongoDB write error)."""
    _runs().update_one(
        {"_id": ObjectId(run_id)},
        {"$set": {"bookkeepingWarning": (str(warning)[:2000] if warning else "bookkeeping failed")}}
    )


def find_runs_by_status(statuses):
    """Py's startup reconciliation to find runs sitting in "activating" or "activated" (see reconcile_orphaned_runs for the pre-existing "queued"/"running"/"evaluating" sweep, which this deliberately does not touch or duplicate -- activation reconciliation needs manifest-aware logic this module has no business implementing itself, since it has no knowledge of the manifest file)."""
    return [_serialize_run(doc) for doc in _runs().find({"status": {"$in": list(statuses)}})]


def persist_model_candidate(run_id, model_version, metrics, validation_result, artifact_path, encoder_classes):
    """Record the candidate bundle's identity, metrics, and validation result onto the run document."""
    _runs().update_one(
        {"_id": ObjectId(run_id)},
        {
            "$set": {
                "modelVersion": model_version,
                "metrics": metrics,
                "validation": validation_result,
                "artifactPath": artifact_path,
                "encoderClasses": encoder_classes,
            }
        }
    )


def get_latest_completed_run(exclude_run_id=None):
    """Py gates 7 and 9). e. e."""
    query = {"status": "completed"}
    if exclude_run_id:
        try:
            query["_id"] = {"$ne": ObjectId(exclude_run_id)}
        except (InvalidId, TypeError):
            pass

    doc = _runs().find_one(query, sort=[("createdAt", -1)])
    return _serialize_run(doc)


def attach_reserved_feedback_ids(run_id, feedback_ids):
    """Record which feedback documents THIS run reserved, at the time it reserved them."""
    _runs().update_one(
        {"_id": ObjectId(run_id)},
        {"$set": {"feedbackDocIds": [str(fid) for fid in feedback_ids]}}
    )


def attach_dataset_metadata(run_id, metadata):
    """Py's build_snapshot_for_run succeeds -- datasetSnapshotPath, datasetHash, rowCounts, rejectedReasons, and conflictCount."""
    _runs().update_one(
        {"_id": ObjectId(run_id)},
        {
            "$set": {
                "datasetSnapshotPath": metadata.get("path"),
                "datasetHash": metadata.get("sha256"),
                "rowCounts": metadata.get("rowCounts"),
                "rejectedReasons": metadata.get("rejectedReasons"),
                "conflictCount": metadata.get("conflictCount"),
            }
        }
    )


def fail_unstarted_run(run_id, reason):
    """G. a lock-claim exception, a thread-construction/start failure, or a stale run displaced by reclaim_stale_lock."""
    mark_failed(run_id, reason)


# MongoDB-backed lock
def _ensure_lock_document():
    """Idempotently create the singleton lock document if it doesn't exist yet."""
    try:
        _locks().update_one(
            {"_id": LOCK_ID},
            {"$setOnInsert": {"locked": False, "runId": None, "heartbeatAt": None}},
            upsert=True
        )
    except DuplicateKeyError:
        pass


def try_claim_lock(run_id):
    """Attempt to atomically claim the retraining lock for `run_id`."""
    _ensure_lock_document()
    now = _utcnow()
    result = _locks().find_one_and_update(
        {"_id": LOCK_ID, "locked": {"$ne": True}},
        {"$set": {"locked": True, "runId": run_id, "heartbeatAt": now}},
        return_document=ReturnDocument.AFTER
    )
    return result is not None and result.get("runId") == run_id


def get_active_lock():
    """Return the current lock document, or None if it has never been created."""
    return _locks().find_one({"_id": LOCK_ID})


def _is_stale(lock_doc, stale_after_seconds):
    """Shared staleness rule used by both the read-only precheck (peek_active_run) and the atomic reclaim path (claim_or_reclaim) so the two can never disagree about what "stale" means."""
    if not lock_doc or not lock_doc.get("locked"):
        return False
    heartbeat_at = lock_doc.get("heartbeatAt")
    if heartbeat_at is None:
        return True
    return (_utcnow() - heartbeat_at).total_seconds() > stale_after_seconds


def reclaim_stale_lock(run_id, expected_old_run_id, stale_after_seconds):
    """Atomically hand the lock to `run_id`, but ONLY IF it is currently held by EXACTLY `expected_old_run_id` (the specific stale owner the caller observed) AND its heartbeat is older than `stale_after_seconds`."""
    if not expected_old_run_id:
        return None

    now = _utcnow()
    stale_before = now - datetime.timedelta(seconds=stale_after_seconds)

    previous = _locks().find_one_and_update(
        {
            "_id": LOCK_ID,
            "locked": True,
            "runId": expected_old_run_id,
            "heartbeatAt": {"$lt": stale_before}
        },
        {"$set": {"locked": True, "runId": run_id, "heartbeatAt": now}},
        return_document=ReturnDocument.BEFORE
    )
    return previous


def release_lock(run_id):
    """Release the lock ONLY IF it is still owned by `run_id`."""
    result = _locks().update_one(
        {"_id": LOCK_ID, "runId": run_id},
        {"$set": {"locked": False, "runId": None, "heartbeatAt": None}}
    )
    return result.modified_count == 1


# Orchestration helpers, kept here so app.py stays a thin route handler.
def peek_active_run(stale_after_seconds):
    """G. the cron firing again while a long training run is still active) leaves no record behind at all."""
    lock_doc = get_active_lock()
    if lock_doc and lock_doc.get("locked") and not _is_stale(lock_doc, stale_after_seconds):
        return lock_doc.get("runId")
    return None


def claim_or_reclaim(run_id, stale_after_seconds):
    """Attempt to have `run_id` take ownership of the retraining lock, either by claiming it outright (nobody currently holds it) or by reclaiming it from a stale holder (locked, but its heartbeat is older than stale_after_seconds)."""
    if try_claim_lock(run_id):
        return True, None

    current_lock = get_active_lock() or {}
    expected_old_run_id = current_lock.get("runId")

    if not _is_stale(current_lock, stale_after_seconds):
        return False, None

    previous = reclaim_stale_lock(run_id, expected_old_run_id, stale_after_seconds)
    if not previous:
        # Lost the race, or the "stale" owner refreshed its heartbeat -- treat as genuinely active.
        return False, None

    return True, previous.get("runId")


def abandon_unclaimed_run(run_id):
    """Remove the bookkeeping document for an attempt that lost a genuine claim race (peek_active_run() reported the lock as free, but a concurrent request won the atomic claim first)."""
    _runs().delete_one({"_id": ObjectId(run_id)})


def reconcile_orphaned_runs(queued_older_than_seconds):
    """1). This is NOT a periodic job, does NOT trigger training, and does NOT touch feedback records or dataset files."""
    queued_failed = 0
    running_failed = 0
    errors = []

    cutoff = _utcnow() - datetime.timedelta(seconds=queued_older_than_seconds)
    current_lock = get_active_lock() or {}
    active_run_id = current_lock.get("runId")

    for doc in list(_runs().find({"status": "queued", "createdAt": {"$lt": cutoff}})):
        try:
            mark_failed(str(doc["_id"]), "orphaned queued run recovered")
            queued_failed += 1
        except Exception as exc:
            errors.append(f"queued run {doc.get('_id')}: {exc}")

    for doc in list(_runs().find({"status": {"$in": ["running", "evaluating"]}})):
        if str(doc["_id"]) != active_run_id:
            try:
                mark_failed(str(doc["_id"]), f"orphaned {doc.get('status')} run recovered")
                running_failed += 1
            except Exception as exc:
                errors.append(f"{doc.get('status')} run {doc.get('_id')}: {exc}")

    return {
        "queuedRunsFailed": queued_failed,
        "runningRunsFailed": running_failed,
        "errors": errors,
    }


# Focused read queries for the operational status API.
def list_runs(limit=20, status=None, before=None):
    """Bounded, sorted listing for GET /training-runs."""
    limit = max(1, min(int(limit), 100))

    query = {}
    if status is not None:
        if status not in ALLOWED_STATUSES:
            raise ValueError(f"unknown status filter: {status!r}")
        query["status"] = status

    if before is not None:
        try:
            query["_id"] = {"$lt": ObjectId(before)}
        except (InvalidId, TypeError):
            raise ValueError(f"invalid cursor: {before!r}")

    docs = list(
        _runs().find(query).sort([("_id", -1)]).limit(limit + 1)
    )
    has_more = len(docs) > limit
    docs = docs[:limit]
    next_cursor = str(docs[-1]["_id"]) if (has_more and docs) else None

    return [_serialize_run(d) for d in docs], next_cursor


def get_run_for_model_version(model_version):
    """Py) to decide whether a bundle directory on disk still has an owning run record, and if so, what that run's status/age is."""
    if not model_version:
        return None
    doc = _runs().find_one({"modelVersion": model_version})
    return _serialize_run(doc)


def get_activated_run(run_id):
    """Training_run_repository's module docstring for what "activated" precisely means)."""
    run = get_run(run_id)
    if run and run.get("status") == "activated":
        return run
    return None


def ensure_indexes():
    """Idempotent index creation for the query patterns this module (and the Phase F status API) actually issues: - {status: 1, createdAt: -1} -- supports list_runs' status filter combined with newest-first ordering, and reconcile_orphaned_runs'/ find_runs_by_status' status-only lookups."""
    try:
        _runs().create_index([("status", 1), ("createdAt", -1)])
        _runs().create_index([("modelVersion", 1)])
    except Exception:
        pass
