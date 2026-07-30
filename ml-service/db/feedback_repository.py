"""
Feedback repository (Phase C).

Owns all MongoDB access to the `mlfeedbacks` collection for the retraining
lifecycle: atomic reservation, cumulative trained-feedback reads, terminal
"needs_review" transitions, failure rollback, and reservation reconciliation
for feedback abandoned by a process kill.

This is a SEPARATE repository from db.training_run_repository (which owns
`mltrainingruns` / `mltraininglocks`). Feedback documents are a distinct
collection with a distinct schema/lifecycle owned by the backend
(backend/config/Schemas.js's MlFeedbackSchema), so keeping their MongoDB
access in its own focused module avoids conflating two different
collections' concerns in one file. Where this module needs to know about a
training run's status (reservation reconciliation), that is passed in by the
caller as a lookup function rather than importing training_run_repository
directly, keeping the two repositories loosely coupled.

Phase A established the feedback lifecycle states this module operates on:

    pending -> reserved -> trained
                        \\-> needs_review   (invalid, terminal)
    reserved -> pending                     (failed run / reconciled, retryable)

Phase C deliberately did NOT introduce a "reserved -> trained" transition
here. Phase E now adds it (finalize_trained_for_run, below), but ONLY as
something app.py's activation workflow calls AFTER a candidate has actually
been published and successfully loaded/smoke-tested by the publishing
process -- never before. Reaching "trained" must always mean the feedback
record genuinely contributed to a model that is now live, not merely that
a training run finished.

Phase E pre-implementation note (see the Phase E final report for the full
verification): the DIRECT failure path in app.py's background_retrain
already correctly returns a validation-failed run's reserved feedback to
"pending" (via release_reserved_for_run, called right after
mark_failed_validation). The gap Phase E closes is in
reconcile_reserved_feedback below, which is a STARTUP-ONLY backstop for
runs that never got a chance to run their own direct rollback (e.g. a
process killed between mark_failed_validation and the rollback call): its
terminal-failure status set did not previously include "failed_validation"
at all (it was written before Phase D introduced that status), so a
feedback document orphaned in exactly that narrow crash window would have
been left "reserved" indefinitely. TERMINAL_FAILURE_STATUSES below is now
the single, explicit, named set this function checks against, extended to
include "failed_validation" and Phase E's own "failed_activation".
"""

import datetime

from bson import ObjectId
from pymongo import ReturnDocument

from db.mongo import get_db

COLLECTION = "mlfeedbacks"

# Kept in sync with backend/config/Schemas.js's MlFeedbackSchema enum.
VALID_STATUSES = {"pending", "reserved", "trained", "needs_review"}

# Runs that will never activate; excludes "activating"/"activated", whose feedback must finalize to "trained".
TERMINAL_FAILURE_STATUSES = {"failed", "failed_validation", "failed_activation"}


def _utcnow():
    return datetime.datetime.utcnow()


def _collection():
    return get_db()[COLLECTION]


def reserve_pending_feedback(run_id):
    """
    Atomically reserve every currently-"pending" feedback document for
    `run_id`, one document at a time via find_one_and_update.

    Concurrency guarantee: each find_one_and_update is a single atomic
    server-side find-and-modify operation. The instant a document's status
    changes from "pending" to "reserved", it can never again match a
    concurrent caller's `{"status": "pending"}` filter -- so no document can
    ever be reserved by two different runs, regardless of how many callers
    invoke this at once. (In normal operation there is only ever one caller
    at a time anyway, since reservation only happens after a run already
    holds the Phase-B singleton lock -- this guarantee is what makes it safe
    even without that external precondition.)

    MongoDB has no atomic "update-and-return-many" primitive, so a
    single-document loop is the smallest race-safe strategy that still
    returns the exact set of documents this run reserved. This is
    proportionate to BALENISA's expected feedback volume -- tens to low
    hundreds of documents per retrain (the backend cron's own threshold is
    100), not a high-throughput pipeline where a per-document round trip
    would matter.

    Returns the list of reserved documents (raw Mongo dicts, including
    their `_id`).
    """
    reserved = []
    while True:
        doc = _collection().find_one_and_update(
            {"status": "pending"},
            {
                "$set": {
                    "status": "reserved",
                    "trainingRunId": run_id,
                    "reservedAt": _utcnow(),
                }
            },
            return_document=ReturnDocument.AFTER
        )
        if doc is None:
            break
        reserved.append(doc)
    return reserved


def get_trained_feedback():
    """
    Read-only: every feedback document already marked "trained" (by a
    future phase's activation step). Never mutates anything -- Phase C's
    cumulative-dataset requirement is explicit that previously trained
    feedback must be read without changing its state.
    """
    return list(_collection().find({"status": "trained"}))


def get_reserved_for_run(run_id):
    """Read-only: the documents currently reserved by a specific run."""
    return list(_collection().find({"status": "reserved", "trainingRunId": run_id}))


def mark_needs_review(feedback_id, reason):
    """
    Transition one feedback document straight to the terminal "needs_review"
    state, with a specific reason. Used for documents that fail Phase C's
    row-level validation (e.g. an unmapped category). These are NOT returned
    to "pending" -- that would retry them forever against the same
    unfixable problem -- a human or a later phase must look at them.
    """
    _collection().update_one(
        {"_id": ObjectId(feedback_id)},
        {
            "$set": {
                "status": "needs_review",
                "lastError": (str(reason)[:500] if reason else "invalid feedback"),
            }
        }
    )


def release_reserved_for_run(run_id, reason):
    """
    Failure rollback: return every "reserved" document belonging to `run_id`
    back to "pending", incrementing its attempt count and recording why, so
    it is picked up again by a future run.

    Filtered on BOTH status:"reserved" AND trainingRunId:run_id, so this can
    only ever touch feedback this specific run reserved -- never another
    run's reservations, never "trained" documents (a different status,
    excluded by the filter), and never "needs_review" documents (also a
    different status -- those are validation-terminal, not retry-eligible).

    Returns the number of documents released.
    """
    result = _collection().update_many(
        {"status": "reserved", "trainingRunId": run_id},
        {
            "$set": {
                "status": "pending",
                "trainingRunId": None,
                "reservedAt": None,
                "lastError": (str(reason)[:500] if reason else "retraining run failed"),
            },
            "$inc": {"attempts": 1},
        }
    )
    return result.modified_count


def finalize_trained_for_run(run_id):
    """
    Phase E: the ONLY place "reserved" feedback ever advances to "trained".
    Callers (app.py's activation workflow, and the Phase E startup
    reconciliation for a run found already "activated" with leftover
    reserved feedback) MUST only call this AFTER the candidate has been
    published and successfully loaded/smoke-tested by the publishing
    process -- never merely because training or validation succeeded.

    Filtered on BOTH status:"reserved" AND trainingRunId:run_id, exactly
    like release_reserved_for_run -- this can only ever touch feedback THIS
    run reserved, never another run's reservations, never already-"trained"
    documents, never "needs_review" documents.

    Audit policy (per the Phase E spec): `trainingRunId` is KEPT (not
    cleared) so it remains possible to trace which run trained a given
    feedback document indefinitely; `reservedAt` and `lastError` are
    cleared (a trained document has no reservation or error to report
    anymore); `trainedAt` is set; `attempts` is left untouched (it already
    correctly reflects how many reservation attempts this document went
    through to get here).

    Idempotent: the filter only matches documents still in "reserved"
    status, so calling this again for a run whose feedback has already
    been finalized (e.g. a duplicate reconciliation pass) matches zero
    documents and is a safe no-op -- it can never re-finalize, and can
    never touch documents that belong to, or were already finalized by, a
    DIFFERENT run.

    Returns the number of documents finalized.
    """
    result = _collection().update_many(
        {"status": "reserved", "trainingRunId": run_id},
        {
            "$set": {
                "status": "trained",
                "trainedAt": _utcnow(),
                "lastError": None,
                "reservedAt": None,
            },
        }
    )
    return result.modified_count


def reconcile_reserved_feedback(get_run, active_run_id):
    """
    Reservation reconciliation (Phase C). Safe to call at ML-service startup
    and/or immediately before a new run reserves feedback (both call sites
    are used -- see app.py's startup handler and
    training/dataset_builder.py's reserve_feedback_for_run). Deliberately
    NOT invoked on prediction requests -- this only ever runs around a
    retrain, which happens at most a handful of times a day.

    `get_run` is training_run_repository.get_run, passed in by the caller
    rather than imported directly, so this module's only direct MongoDB
    dependency stays scoped to its own `mlfeedbacks` collection.

    For every currently "reserved" feedback document:
      - if its trainingRunId is `active_run_id` (the run currently holding
        the Phase-B lock) -> left untouched, still legitimately owned.
      - if its referenced run does not exist at all -> released back to
        "pending" with a distinct recovery reason.
      - if its referenced run is terminal ("failed" or "completed") ->
        released back to "pending".
      - if its referenced run exists but is still "queued"/"running" AND is
        NOT the current active lock holder -> a stale run that has not yet
        been formally failed by the Phase-B stale-run mechanism
        (claim_or_reclaim -> fail_unstarted_run). Left untouched here on
        purpose: recovering its feedback before that run is formally failed
        would risk two runs believing they own the same feedback if the
        "stale" run turns out to still be alive. The NEXT retrain trigger's
        claim_or_reclaim will resolve it; the reservation is then recovered
        on the following reconciliation pass.

    Never touches "pending", "trained", or "needs_review" documents.

    Returns the number of documents released.
    """
    released = 0

    for doc in list(_collection().find({"status": "reserved"})):
        run_id = doc.get("trainingRunId")
        run_id_str = str(run_id) if run_id else None

        if run_id_str == active_run_id:
            continue

        run = get_run(run_id_str) if run_id_str else None

        if run is None:
            reason = "referenced training run is missing"
        elif run.get("status") in TERMINAL_FAILURE_STATUSES or run.get("status") == "completed":
            # "completed" (legacy-only) never activated either, so its reservations are equally safe to release.
            reason = "training run failed or completed without activation"
        else:
            # Stale but not yet formally failed, or activating/activated -- left untouched; see module docstring.
            continue

        _collection().update_one(
            {"_id": doc["_id"]},
            {
                "$set": {
                    "status": "pending",
                    "trainingRunId": None,
                    "reservedAt": None,
                    "lastError": reason,
                },
                "$inc": {"attempts": 1},
            }
        )
        released += 1

    return released
