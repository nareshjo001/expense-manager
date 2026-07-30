"""
Training-run repository (Phase B, hardened in Phase B.1).

The single place that issues raw MongoDB queries for the retraining
lifecycle. app.py and training/retrain_pipeline.py call into the functions
below rather than touching pymongo directly, so the atomic-claim /
owner-checked-release / stale-detection / orphan-recovery logic lives in
exactly one module.

Owns two small collections in the existing database (see db.mongo):

  mltrainingruns  - one persistent document per retraining attempt that
                    actually had a chance to run (see abandon_unclaimed_run
                    for the one deliberate exception to "every attempt").
  mltraininglocks - a single singleton document that represents "is a
                    training run currently allowed to execute, and which
                    run owns that right right now".

Phase B statuses:

    queued -> running -> completed
    queued -> running -> failed

Phase D extends the status set with two more (see ALLOWED_STATUSES below):

    queued -> running -> evaluating -> completed          (validation passed)
    queued -> running -> evaluating -> failed_validation  (validation failed)
    queued -> running -> failed                           (training itself failed,
                                                             never reached evaluating)

Note what "completed" means as of Phase D: a run only reaches "completed"
after BOTH training succeeded AND the candidate bundle passed all 9
validation gates (see training/model_validation.py). This is NOT the same
as "the model is live" -- no run status in this module ever means that;
runtime activation is Phase E's job. get_latest_completed_run() below
relies on this meaning of "completed" to source a trustworthy baseline for
future runs' regression/category-set comparisons.

"failed_validation" is deliberately distinct from the pre-existing
"failed" status: "failed" means training itself broke (an exception,
before a candidate bundle could even be produced); "failed_validation"
means training succeeded and produced a candidate bundle, but that bundle
did not pass one or more of the 9 gates. Keeping them separate lets a
future dashboard (out of scope here) distinguish "the trainer is broken"
from "the trainer works, but this particular candidate wasn't good
enough" without parsing failureReason text.

Phase E extends the status set again, adding the activation stage between
validation and the two possible final outcomes:

    queued -> running -> evaluating -> activating -> activated
                                     \\-> failed_activation

"completed" is kept in ALLOWED_STATUSES for backward compatibility (old
documents, and the module's own docstrings/tests referencing it), but as
of Phase E the successful path no longer stops at "completed" at all --
validation success flows directly into "activating" in the same
background-thread call, with no persisted gap at "completed" in between.
Practically, a run will only ever be seen sitting at "completed" if it was
created before Phase E shipped. Per the task's own guidance to prefer
minimal compatibility changes, "completed" is NOT renamed/removed; it is
simply superseded by "activated" as the new terminal-success status going
forward.

"failed_activation" is distinct from "failed_validation": it means
training AND validation both succeeded (a publishable candidate existed),
but something in the activation workflow itself failed -- runtime loading,
manifest publication, the post-swap smoke test, etc. -- see
training/model_bundle.py's manifest functions and
inference/predictor_manager.py for what "activation" actually does.

"activated" means, precisely: the validated candidate was published (its
manifest atomically points at it) AND the publishing process itself
successfully loaded it into its own runtime snapshot and passed a
post-swap smoke prediction. It does NOT mean every other worker/replica
has picked it up yet -- see inference/predictor_manager.py's multi-worker
lazy-reload mechanism for how other processes eventually catch up.

Phase B.1 additions:
  - reclaim_stale_lock() now requires the caller to name the exact stale
    owner it observed, closing a theoretical multi-owner ambiguity.
  - abandon_unclaimed_run() / peek_active_run() / claim_or_reclaim() support
    a "harmless duplicate trigger leaves no failed record" policy.
  - fail_unstarted_run() names the specific case of a run that never reached
    "running".
  - reconcile_orphaned_runs() is a startup-only sweep for the residual gap
    no try/except can close: a hard process kill between create_run() and
    any of this module's own cleanup code running at all.

Phase D additions:
  - mark_evaluating() / mark_failed_validation() support the new
    "evaluating" stage between "running" and the two possible terminal
    outcomes.
  - persist_model_candidate() records the versioned bundle's identity,
    metrics, and validation result onto the run document once training +
    validation have both finished (regardless of which way validation
    went) -- called before mark_completed/mark_failed_validation by
    app.py's background_retrain.
  - get_latest_completed_run() sources the previous-model baseline for
    regression/category-set comparisons -- see training/model_validation.py
    gates 7 and 9.
  - reconcile_orphaned_runs() now also treats "evaluating" as an
    in-progress status for lock-orphan detection (pattern 2), the same way
    it already treated "running" -- a run stuck in "evaluating" whose runId
    no longer matches the current lock owner is just as orphaned as one
    stuck in "running".
"""

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
    }


def resolve_trigger_source(requested_source):
    """
    Never trust an arbitrary client-supplied trigger value directly. Any
    value outside ALLOWED_TRIGGER_SOURCES (including missing/None) falls
    back to "api" — matching today's only caller (the backend cron), which
    does not yet send a source and is not being changed in this phase.
    """
    if requested_source in ALLOWED_TRIGGER_SOURCES:
        return requested_source
    return "api"


# Training-run records
def create_run(requested_trigger_source=None):
    """
    Create a new run record in "queued" status.

    Callers should prefer checking peek_active_run() first so a harmless
    duplicate trigger never reaches this function at all (see app.py). A
    record created here is expected to shortly become "running" or be
    resolved to a terminal "failed" state (or removed via
    abandon_unclaimed_run, for the one case where "failed" would be
    misleading) — it must never be left "queued" indefinitely.
    """
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
    """
    Meant to be called at meaningful stage boundaries during an active run
    (see training/retrain_pipeline.py's heartbeat_callback). A heartbeat
    write failure is handled by the caller as best-effort — it must never be
    allowed to abort an in-progress training run.
    """
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
    """
    General-purpose terminal-failure primitive: sets status, completedAt,
    and a sanitized (length-capped, never-empty) failureReason, regardless
    of the run's current status. Safe to call whether the run was "queued"
    or "running" — every other "fail_*" helper in this module is a thin,
    semantically-named wrapper around this one operation.
    """
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
    """
    Phase D: transition a run from "running" to "evaluating" once trainer.py
    has finished (produced a candidate bundle) and validate_model.py is
    about to be invoked. Deliberately a distinct status from "running" so a
    run stuck here (rather than in the training subprocess itself) is
    immediately distinguishable -- e.g. by reconcile_orphaned_runs, which
    treats "evaluating" the same as "running" for orphan detection.
    """
    _runs().update_one(
        {"_id": ObjectId(run_id)},
        {"$set": {"status": "evaluating", "heartbeatAt": _utcnow()}}
    )


def mark_failed_validation(run_id, reason):
    """
    Phase D: terminal failure specifically for "training succeeded, but the
    candidate bundle did not pass validation" -- distinct from mark_failed's
    "failed" status, which means training itself broke before a candidate
    bundle could even be produced. See this module's docstring for the
    full distinction. Uses the same sanitized, length-capped, never-empty
    reason handling as mark_failed.
    """
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
    """
    Phase E: transition a run from "evaluating" (validation just passed) to
    "activating" -- the run now has a publishable candidate and the
    background workflow is about to attempt runtime activation (preload,
    manifest publication, local snapshot swap, post-swap smoke test).

    `previous_model_version` is recorded now (not later) so that even if
    the process crashes mid-activation, a startup reconciliation pass can
    see what the ROLLBACK target should have been without needing to
    re-derive it from a manifest that may itself already be gone/replaced.
    """
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
    """
    Phase E: terminal SUCCESS status. Means: the candidate was published
    (active.json points at it) AND the publishing process itself
    successfully loaded it and passed a post-swap smoke prediction.

    `activation_metadata` is the compact structured dict described in the
    Phase E spec (e.g. {"passed": True, "loadedModelVersion": ...,
    "manifestGeneration": ..., "failureReason": None}) -- never large
    artifacts, never a raw stack trace.
    """
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
    """
    Phase E: terminal failure specifically for "training and validation
    both succeeded, but something in the activation workflow itself
    failed" -- runtime load failure, manifest publication failure, or a
    post-swap smoke-test failure (even after a successful rollback of the
    manifest/runtime). Distinct from mark_failed and mark_failed_validation
    for the same reason those two are distinct from each other -- see this
    module's docstring.
    """
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


def mark_bookkeeping_warning(run_id, warning):
    """
    Phase E: records a non-fatal bookkeeping problem on an ALREADY-
    activated run -- specifically, the case where activation itself fully
    succeeded (the model is live) but finalizing this run's reserved
    feedback to "trained" failed for some reason (e.g. a transient MongoDB
    write error). Per the Phase E spec's explicit distinction: this must
    NEVER roll back the active model, and must NEVER return the feedback to
    "pending" (the live model already includes it) -- it only leaves a
    breadcrumb for an operator/reconciliation pass. Does not change
    `status` -- the run stays "activated".
    """
    _runs().update_one(
        {"_id": ObjectId(run_id)},
        {"$set": {"bookkeepingWarning": (str(warning)[:2000] if warning else "bookkeeping failed")}}
    )


def find_runs_by_status(statuses):
    """
    Phase E: plain read used by app.py's startup reconciliation to find
    runs sitting in "activating" or "activated" (see reconcile_orphaned_runs
    for the pre-existing "queued"/"running"/"evaluating" sweep, which this
    deliberately does not touch or duplicate -- activation reconciliation
    needs manifest-aware logic this module has no business implementing
    itself, since it has no knowledge of the manifest file).
    """
    return [_serialize_run(doc) for doc in _runs().find({"status": {"$in": list(statuses)}})]


def persist_model_candidate(run_id, model_version, metrics, validation_result, artifact_path, encoder_classes):
    """
    Phase D: record the candidate bundle's identity, metrics, and
    validation result onto the run document. Called once, after training +
    validation have both finished (regardless of which way validation
    went), before the caller (app.py's background_retrain) transitions the
    run to its terminal status via mark_completed or mark_failed_validation.

    Deliberately stores only compact, structured data (a version string, a
    metrics dict, the validation gate results, a filesystem path, and a
    list of class-name strings) -- never the model/vectorizer/encoder
    binaries themselves and never a raw classification report. The large
    artifacts stay on disk under training/models/<modelVersion>/, and this
    document only ever points at them by path.

    Safe to call regardless of the run's current status; does not itself
    touch status/timestamps -- callers decide those separately.
    """
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
    """
    Phase D: source of the previous-model baseline for regression /
    category-set comparisons (training/model_validation.py gates 7 and 9).

    Returns the serialized most-recent run with status "completed" (i.e.
    training succeeded AND validation passed), sorted by createdAt
    descending, or None if no such run exists yet -- which callers MUST
    treat as "no baseline available", never inventing a substitute
    accuracy or category set for a first run. `exclude_run_id` lets the
    current in-progress run exclude itself, which matters if this is ever
    called after persist_model_candidate has already written partial data
    for the current run (it has not, as of Phase D's own call site in
    app.py, which fetches the baseline BEFORE the current run starts
    training -- but excluding defensively costs nothing and avoids a
    future footgun if that ordering ever changes).
    """
    query = {"status": "completed"}
    if exclude_run_id:
        try:
            query["_id"] = {"$ne": ObjectId(exclude_run_id)}
        except (InvalidId, TypeError):
            pass

    doc = _runs().find_one(query, sort=[("createdAt", -1)])
    return _serialize_run(doc)


def attach_reserved_feedback_ids(run_id, feedback_ids):
    """
    Phase C: record which feedback documents THIS run reserved, at the time
    it reserved them.

    Deliberately bounded and NOT an unbounded audit log of "every feedback
    document ever associated with a run" -- it is overwritten with exactly
    the current run's own reservation batch (normally tens to low hundreds
    of ids, matching the backend cron's own retraining threshold). This is
    still useful even though `mlfeedbacks.trainingRunId` also links each
    feedback document back to its run, because a FAILED run's rollback
    (db.feedback_repository.release_reserved_for_run) clears
    `trainingRunId` on the feedback side as part of returning it to
    "pending" -- after that, this array on the run record is the only
    remaining trace of which documents were involved in the attempt.

    For a full, always-current query instead of this snapshot array, use
    `db.mlfeedbacks.find({trainingRunId: <runId>})` while the run is still
    active (before any rollback clears it).
    """
    _runs().update_one(
        {"_id": ObjectId(run_id)},
        {"$set": {"feedbackDocIds": [str(fid) for fid in feedback_ids]}}
    )


def attach_dataset_metadata(run_id, metadata):
    """
    Phase C: persist dataset-assembly metadata onto the run document once
    training/dataset_builder.py's build_snapshot_for_run succeeds --
    datasetSnapshotPath, datasetHash, rowCounts, rejectedReasons, and
    conflictCount. Does not touch status or timestamps; callers decide those
    separately via mark_completed/mark_failed.
    """
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
    """
    Fail a run that never reached "running" — e.g. a lock-claim exception, a
    thread-construction/start failure, or a stale run displaced by
    reclaim_stale_lock. Named separately from mark_completed's failure
    sibling purely to make call sites self-documenting about *when* in the
    lifecycle the failure occurred; the underlying operation is identical.
    """
    mark_failed(run_id, reason)


# MongoDB-backed lock
def _ensure_lock_document():
    """
    Idempotently create the singleton lock document if it doesn't exist yet.

    Safe under concurrent callers: if two processes race to create it for
    the first time, MongoDB's unique `_id` guarantees only one insert wins.
    The loser's DuplicateKeyError just means someone else already created
    the same document an instant earlier, which is exactly what we want —
    it is ignored rather than treated as an error.
    """
    try:
        _locks().update_one(
            {"_id": LOCK_ID},
            {"$setOnInsert": {"locked": False, "runId": None, "heartbeatAt": None}},
            upsert=True
        )
    except DuplicateKeyError:
        pass


def try_claim_lock(run_id):
    """
    Attempt to atomically claim the retraining lock for `run_id`.

    This is a single find_one_and_update against the singleton lock
    document, filtered on `locked: {"$ne": True}`. MongoDB executes the
    find-and-modify pair as ONE atomic operation on the server: whichever
    caller's update is applied first sets `locked: True`, which makes every
    other concurrent caller's filter stop matching immediately afterward.
    That holds regardless of whether the concurrent callers are separate
    threads in one process, separate Uvicorn workers, or separate service
    replicas — they are all just clients issuing operations against the same
    MongoDB document, and MongoDB itself serializes single-document writes.

    Returns True if this call claimed the lock, False otherwise.
    """
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
    """Shared staleness rule used by both the read-only precheck
    (peek_active_run) and the atomic reclaim path (claim_or_reclaim) so the
    two can never disagree about what "stale" means."""
    if not lock_doc or not lock_doc.get("locked"):
        return False
    heartbeat_at = lock_doc.get("heartbeatAt")
    if heartbeat_at is None:
        return True
    return (_utcnow() - heartbeat_at).total_seconds() > stale_after_seconds


def reclaim_stale_lock(run_id, expected_old_run_id, stale_after_seconds):
    """
    Atomically hand the lock to `run_id`, but ONLY IF it is currently held by
    EXACTLY `expected_old_run_id` (the specific stale owner the caller
    observed) AND its heartbeat is older than `stale_after_seconds`.

    Including `expected_old_run_id` in the atomic filter — rather than just
    "locked: True, heartbeat stale" — guarantees this call can only ever
    replace the specific owner the caller believes is stale, never some
    different run that may have taken over the lock in between the caller's
    earlier read and this call. Combined with the heartbeat condition being
    re-evaluated as part of the same atomic operation, two concurrent
    callers who both observed the same stale owner cannot both succeed: the
    winner's write refreshes `runId` and `heartbeatAt`, which makes the
    filter (`runId: expected_old_run_id`, stale heartbeat) stop matching for
    the other caller an instant later. This is a conditional update, never
    an unconditional overwrite of the singleton document.

    Returns the PREVIOUS lock document (so the caller can see and fail the
    exact old runId) if this call performed the reclaim, or None if the
    lock was not held by expected_old_run_id, was not stale, or was already
    reclaimed by someone else.
    """
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
    """
    Release the lock ONLY IF it is still owned by `run_id`.

    This is the owner-check that prevents an old or superseded process from
    ever releasing a lock a newer run has since claimed: the filter requires
    `runId` to match exactly. If this run's ownership has already been
    reassigned (e.g. via reclaim_stale_lock while this run was considered
    stale), this update matches zero documents and is a safe no-op — it does
    NOT release the newer run's lock.

    Safe to call even when `run_id` never actually held the lock (e.g. a
    claim attempt that raised before succeeding) — it will simply match
    nothing. This lets callers call it unconditionally during cleanup
    without first having to know whether they really owned the lock.

    Returns True if this call actually released the lock.
    """
    result = _locks().update_one(
        {"_id": LOCK_ID, "runId": run_id},
        {"$set": {"locked": False, "runId": None, "heartbeatAt": None}}
    )
    return result.modified_count == 1


# Orchestration helpers, kept here so app.py stays a thin route handler.
def peek_active_run(stale_after_seconds):
    """
    Cheap, non-mutating read used to short-circuit an obviously-redundant
    retrain request BEFORE a training-run document is ever created for it —
    so a routine duplicate trigger (e.g. the cron firing again while a long
    training run is still active) leaves no record behind at all. Per Phase
    B.1 policy, "found something already running" is not a failure and must
    not be persisted as one.

    This is a plain read with no locking of its own, so it is inherently a
    check-then-act race: the lock can change between this call and whatever
    the caller does next. That is fine — it is only a fast-path
    optimization. claim_or_reclaim() (an atomic operation) remains the
    actual source of truth and is always still attempted afterward
    regardless of what this function returns.

    Returns the active run's id if the lock is currently held by a live
    (non-stale) run, else None.
    """
    lock_doc = get_active_lock()
    if lock_doc and lock_doc.get("locked") and not _is_stale(lock_doc, stale_after_seconds):
        return lock_doc.get("runId")
    return None


def claim_or_reclaim(run_id, stale_after_seconds):
    """
    Attempt to have `run_id` take ownership of the retraining lock, either by
    claiming it outright (nobody currently holds it) or by reclaiming it
    from a stale holder (locked, but its heartbeat is older than
    stale_after_seconds).

    Returns a tuple (claimed, stale_run_id):
      (True,  None)     -- claimed cleanly, nobody else held the lock
      (True,  "<runId>")-- reclaimed from a stale holder; the caller is
                            responsible for marking that runId failed via
                            fail_unstarted_run()
      (False, None)     -- the lock is genuinely held by a live, non-stale
                            run (or a stale-looking lock was reclaimed by a
                            concurrent caller a moment before this one)

    This function does not itself mutate the displaced run's status — that
    stays the caller's responsibility — so its only contract is "who owns
    the lock now", keeping it a pure lock operation that composes cleanly
    with the caller's own cleanup/response logic.
    """
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
    """
    Remove the bookkeeping document for an attempt that lost a genuine claim
    race (peek_active_run() reported the lock as free, but a concurrent
    request won the atomic claim first). This is NOT a system failure — the
    caller's underlying intent, "a retrain is happening", is already
    satisfied by whichever run did win — so per Phase B.1 policy this
    attempt is not kept as a misleading "failed" record.

    Only ever appropriate for a run that never owned the lock and never
    reached "running". Safe to call even if the document is already gone.
    """
    _runs().delete_one({"_id": ObjectId(run_id)})


def reconcile_orphaned_runs(queued_older_than_seconds):
    """
    Startup-only sweep (Phase B.1). This is NOT a periodic job, does NOT
    trigger training, and does NOT touch feedback records or dataset files.
    Its only purpose is to resolve this service's own bookkeeping collection
    for the one residual gap no try/except inside a request can close: a
    hard process kill between create_run() succeeding and any of this
    module's own cleanup code getting a chance to run at all.

    Two patterns are recognized and both resolved as "failed":

      1. status "queued" AND createdAt older than
         `queued_older_than_seconds`. Nothing legitimate takes this long to
         go from create_run() to either owning the lock or being cleaned up
         by /retrain-model's hardened error handling, so this can only mean
         the process died mid-request before that handling ran.

      2. status "running" OR "evaluating" AND its runId no longer matches
         the current lock's runId. The lock has since moved on (via a stale
         reclaim) to a different run, so this run will never resume — it is
         provably done one way or another and is no longer relevant to lock
         ownership. "evaluating" is included here (Phase D) for the same
         reason "running" is: both are non-terminal, in-progress statuses
         that only make sense while this run still owns the lock.

    Never raises — the caller (app.py's startup handler) is expected to
    treat any exception here as a controlled, logged warning, not a startup
    failure, since MongoDB may be temporarily unreachable at boot.

    Phase F: returns a STRUCTURED breakdown rather than a bare total count
    (see the Phase F reconciliation-reporting requirement), so the startup
    handler can log/report exactly how many of each pattern were resolved
    rather than one opaque number. The only consumer of this return value
    is app.py's startup handler, so widening it from an int to a dict here
    is a safe, self-contained change.

        {"queuedRunsFailed": int, "runningRunsFailed": int, "errors": [str, ...]}

    `errors` collects a sanitized message per per-document failure (e.g. a
    single bad update) WITHOUT aborting the rest of the sweep -- one
    problem document must never stop every other orphaned run from being
    resolved.
    """
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
    """
    Bounded, sorted listing for GET /training-runs.

    - `limit` is clamped to [1, 100] regardless of what is requested --
      callers can never force an unbounded scan of the collection.
    - `status`, if given, must be one of ALLOWED_STATUSES -- raises
      ValueError otherwise so the route layer can turn that into a 400
      rather than silently ignoring an unrecognized filter or (worse)
      passing it through to MongoDB unfiltered.
    - `before`, if given, is an opaque cursor -- specifically, the `runId`
      of the last item from a previous page. Pagination sorts by `_id`
      descending (MongoDB ObjectIds embed a creation timestamp and a
      monotonic per-process counter, so sorting by `_id` produces the same
      "newest first" ordering as sorting by `createdAt` while making
      "give me everything before this cursor" a single, index-friendly
      `_id: {"$lt": ...}` comparison -- no separate tie-breaker field
      needed). Raises ValueError for a malformed cursor.

    This queries at most `limit + 1` documents (one extra, only to detect
    "is there a next page" without a separate count query) -- it never
    scans or returns the entire collection.

    Returns (items: list[dict], next_cursor: str or None).
    """
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
    """
    Phase F: looks up the run that produced a given versioned bundle --
    used by the artifact-cleanup classifier (training/model_cleanup.py) to
    decide whether a bundle directory on disk still has an owning run
    record, and if so, what that run's status/age is.

    Returns a serialized run, or None if no run recorded this
    modelVersion (the bundle is then classified conservatively as
    "orphaned"/"unknown" by the cleanup module, never assumed safe).
    """
    if not model_version:
        return None
    doc = _runs().find_one({"modelVersion": model_version})
    return _serialize_run(doc)


def get_activated_run(run_id):
    """
    Phase F: returns the serialized run ONLY if it is currently in the
    terminal "activated" status -- returns None for a valid run id whose
    status is anything else (including a run that WAS activated and has
    since been superseded by a newer activation, since this module does
    not track "supersession" as its own concept; see
    db.training_run_repository's module docstring for what "activated"
    precisely means).
    """
    run = get_run(run_id)
    if run and run.get("status") == "activated":
        return run
    return None


def ensure_indexes():
    """
    Phase F: idempotent index creation for the query patterns this module
    (and the Phase F status API) actually issues:

      - {status: 1, createdAt: -1}  -- supports list_runs' status filter
        combined with newest-first ordering, and reconcile_orphaned_runs'/
        find_runs_by_status' status-only lookups.
      - {modelVersion: 1}           -- supports get_run_for_model_version.

    create_index is idempotent in MongoDB itself (creating an index that
    already exists with the same spec is a safe no-op), so this can be
    called on every startup without needing its own "have I already done
    this" bookkeeping. Never raises -- called from app.py's startup
    handler under the same "must not block startup" guarantee as the
    other startup steps; a failure here only means queries fall back to a
    full collection scan, which is a performance concern, not a
    correctness one.
    """
    try:
        _runs().create_index([("status", 1), ("createdAt", -1)])
        _runs().create_index([("modelVersion", 1)])
    except Exception:
        pass
