"""
Cumulative training-dataset assembly (Phase C).

Replaces the old export_feedback.py -> merge_datasets.py -> shared,
overwritten retrain_data.csv flow (see those files' own module docstrings
for why they are no longer invoked by the pipeline) with two explicit
stages:

  1. reserve_feedback_for_run(run_id)
       Reconciles any feedback left "reserved" by a terminal/missing run
       (see db.feedback_repository.reconcile_reserved_feedback), then
       atomically reserves all currently-"pending" feedback for `run_id`
       (db.feedback_repository.reserve_pending_feedback).

  2. build_snapshot_for_run(run_id, reservation)
       Reads the static base dataset, reads all cumulative "trained"
       feedback PLUS this run's freshly "reserved" feedback (without
       mutating "trained" documents), validates and normalizes every
       feedback row, applies a deterministic duplicate cap and conflict
       count, writes an immutable run-specific CSV snapshot via a
       temp-file-then-atomic-rename, computes its SHA-256 hash, and returns
       a metadata dict intended to be persisted onto the training-run
       document by the caller (see training/retrain_pipeline.py and
       app.py's background_retrain).

Neither function mutates "trained" feedback. build_snapshot_for_run mutates
ONLY this run's own invalid "reserved" rows, transitioning them to
"needs_review" -- never anything reserved by another run.
"""

import os
import csv
import hashlib
import tempfile
import datetime

from db import feedback_repository as feedback
from training import category_config

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DATASET_PATH = os.path.join(CURRENT_DIR, "dataset", "merged_expenses.csv")
RUNS_DIR = os.path.join(CURRENT_DIR, "dataset", "runs")

# Exact columns trainer.py expects; no MongoDB ids, statuses, or other lifecycle fields written into trainer input.
SNAPSHOT_COLUMNS = ["expenseName", "expenseCategory"]

# Caps identical (normalized expenseName, canonical category) feedback pairs so one correction can't dominate a retrain.
DUPLICATE_CAP = int(os.getenv("ML_FEEDBACK_DUPLICATE_CAP", "3"))


def reserve_feedback_for_run(run_id):
    """
    Stage 1. Runs reservation reconciliation first (cheap: bounded by the
    number of currently-"reserved" documents, which is normally zero or a
    handful) so a feedback document abandoned by a previous run that crashed
    mid-pipeline is returned to "pending" and can be picked up by this run,
    rather than staying invisibly stuck. Then atomically reserves every
    currently-"pending" document for `run_id`.

    Returns the list of raw (serialized) reserved documents.
    """
    # Local import: not a cycle (training_run_repository doesn't import dataset_builder); coupling is one read only.
    from db import training_run_repository as runs

    active_lock = runs.get_active_lock() or {}
    active_run_id = active_lock.get("runId") if active_lock.get("locked") else None
    feedback.reconcile_reserved_feedback(runs.get_run, active_run_id)

    return feedback.reserve_pending_feedback(run_id)


def _read_base_rows():
    """
    Reads the static base dataset unchanged, as (expenseName,
    expenseCategory) tuples. Deliberately does not normalize/validate base
    rows here -- trainer.py already performs its own cleaning and
    category-mapping pass over the FULL combined dataset (base rows
    included), and Phase C does not change that. This function's only job
    is to read the file whose row count seeds rowCounts.base.
    """
    rows = []
    with open(BASE_DATASET_PATH, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for record in reader:
            rows.append((record.get("expenseName", ""), record.get("expenseCategory", "")))
    return rows


def _validate_feedback_doc(doc):
    """
    Validates one feedback document against the canonical schema Phase C
    requires before it can enter a training snapshot.

    Returns (is_valid, normalized_expense_name, canonical_category, reason).
    `reason` is populated (and the normalized fields are None) when
    is_valid is False, always a specific, non-generic string suitable for
    both a feedback document's lastError and the run's rejectedReasons
    tally. Never raises -- a malformed document (missing/wrong-typed
    fields) is simply reported invalid, not allowed to crash the run.
    """
    try:
        raw_name = doc.get("expenseName")
        raw_category = doc.get("actualCategory")
    except AttributeError:
        return False, None, None, "malformed feedback record (not a document)"

    expense_name = category_config.normalize_expense_name(raw_name)
    if not expense_name:
        return False, None, None, "empty or missing expense name"

    canonical_category = category_config.normalize_category(raw_category)
    if canonical_category is None:
        return False, None, None, f"unrecognized category: {raw_category!r}"

    return True, expense_name, canonical_category, None


def _sort_key(row):
    """
    Deterministic ordering for duplicate-cap processing: group by
    (normalized name, canonical category), then prefer the earliest-created
    document within a group (so, among duplicates, the run consistently
    "keeps the earliest N, caps the rest" rather than an arbitrary Mongo
    cursor order), with the document id as a final tiebreaker for full
    reproducibility given identical input data.
    """
    _source, name, category, doc = row
    created_at = doc.get("createdAt") or doc.get("reservedAt") or datetime.datetime.min
    return (name, category, created_at, str(doc.get("_id", "")))


def build_snapshot_for_run(run_id, reservation):
    """
    Stage 2. Assembles the cumulative dataset for `run_id` and writes it as
    an immutable, run-specific CSV snapshot.

    `reservation` is the list returned by reserve_feedback_for_run (this
    run's freshly reserved documents) -- passed in explicitly rather than
    re-queried, so this function operates on exactly the set the caller just
    reserved, with no risk of a second read observing a different set.

    Returns a metadata dict:
        {
            "path": <absolute file path>,
            "sha256": <hex digest>,
            "rowCounts": {
                "base": int,
                "trainedFeedback": int,
                "currentReserved": int,
                "acceptedFeedback": int,
                "rejectedFeedback": int,
                "duplicatesCapped": int,
                "finalDataset": int,
            },
            "rejectedReasons": {<reason>: count, ...},
            "conflictCount": int,
        }
    """
    base_rows = _read_base_rows()

    trained_docs = feedback.get_trained_feedback()
    reserved_docs = reservation

    rejected_reasons = {}

    def _record_rejection(reason):
        rejected_reasons[reason] = rejected_reasons.get(reason, 0) + 1

    accepted_rows = []       # (source, normalized_name, canonical_category, doc)
    needs_review = []        # (feedback_id, reason) -- this run's invalid reservations only

    # Previously trained feedback: validated for snapshot inclusion only, never mutated.
    trained_rejected = 0
    for doc in trained_docs:
        is_valid, name, category, reason = _validate_feedback_doc(doc)
        if not is_valid:
            _record_rejection(f"previously_trained_now_invalid: {reason}")
            trained_rejected += 1
            continue
        accepted_rows.append(("trained", name, category, doc))

    # This run's freshly reserved feedback: invalid ones transition reserved -> needs_review with a reason.
    for doc in reserved_docs:
        is_valid, name, category, reason = _validate_feedback_doc(doc)
        if not is_valid:
            _record_rejection(reason)
            needs_review.append((str(doc["_id"]), reason))
            continue
        accepted_rows.append(("reserved", name, category, doc))

    for feedback_id, reason in needs_review:
        feedback.mark_needs_review(feedback_id, reason)

    accepted_feedback_count = len(accepted_rows)
    rejected_feedback_count = trained_rejected + len(needs_review)

    # Deterministic duplicate cap, scoped to feedback rows only -- the static base dataset is unaffected.
    accepted_rows.sort(key=_sort_key)

    pair_counts = {}
    name_categories = {}
    duplicates_capped = 0
    final_feedback_rows = []

    for _source, name, category, _doc in accepted_rows:
        pair_key = (name, category)
        pair_counts[pair_key] = pair_counts.get(pair_key, 0) + 1
        if pair_counts[pair_key] > DUPLICATE_CAP:
            duplicates_capped += 1
            continue
        final_feedback_rows.append((name, category))
        name_categories.setdefault(name, set()).add(category)

    # Conflicting labels (same name, multiple valid categories) are retained as-is -- no automatic winner.
    conflict_count = sum(1 for cats in name_categories.values() if len(cats) > 1)

    # Write the immutable run-specific snapshot.
    run_dir = os.path.join(RUNS_DIR, run_id)
    os.makedirs(run_dir, exist_ok=True)
    final_path = os.path.join(run_dir, "training_dataset.csv")

    if os.path.exists(final_path):
        # A run's snapshot is unique to run_id and must never be silently overwritten by a second attempt.
        raise RuntimeError(
            f"snapshot already exists for run {run_id} -- refusing to overwrite"
        )

    fd, tmp_path = tempfile.mkstemp(dir=run_dir, prefix=".tmp-snapshot-", suffix=".csv")
    try:
        with os.fdopen(fd, "w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(SNAPSHOT_COLUMNS)
            for name, category in base_rows:
                writer.writerow([name, category])
            for name, category in final_feedback_rows:
                writer.writerow([name, category])
        os.replace(tmp_path, final_path)  # atomic rename on the same filesystem
    except Exception:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise

    sha256 = hashlib.sha256()
    with open(final_path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            sha256.update(chunk)

    row_counts = {
        "base": len(base_rows),
        "trainedFeedback": len(trained_docs),
        "currentReserved": len(reserved_docs),
        "acceptedFeedback": accepted_feedback_count,
        "rejectedFeedback": rejected_feedback_count,
        "duplicatesCapped": duplicates_capped,
        "finalDataset": len(base_rows) + len(final_feedback_rows),
    }

    return {
        "path": final_path,
        "sha256": sha256.hexdigest(),
        "rowCounts": row_counts,
        "rejectedReasons": rejected_reasons,
        "conflictCount": conflict_count,
    }
