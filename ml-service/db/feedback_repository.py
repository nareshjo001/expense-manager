"""Feedback repository (Phase C)."""

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
    """Atomically reserve every currently-"pending" feedback document for `run_id`, one document at a time via find_one_and_update."""
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
    """Read-only: every feedback document already marked "trained" (by a future phase's activation step)."""
    return list(_collection().find({"status": "trained"}))


def get_reserved_for_run(run_id):
    """Read-only: the documents currently reserved by a specific run."""
    return list(_collection().find({"status": "reserved", "trainingRunId": run_id}))


def mark_needs_review(feedback_id, reason):
    """Transition one feedback document straight to the terminal "needs_review" state, with a specific reason."""
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
    """Failure rollback: return every "reserved" document belonging to `run_id` back to "pending", incrementing its attempt count and recording why, so it is picked up again by a future run."""
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
    """The ONLY place "reserved" feedback ever advances to "trained"."""
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
    """Reservation reconciliation (Phase C). py's reserve_feedback_for_run)."""
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
