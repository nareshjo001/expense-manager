"""
Versioned model-bundle retention and cleanup (Phase F).

Classifies every bundle directory under training/models/ into one of a
fixed set of categories using the manifest, MongoDB run records, bundle
metadata, and age -- NEVER by loading arbitrary pickle contents just to
decide whether something is safe to delete -- and then deletes only the
entries that are unambiguously safe under a conservative retention
policy.

This module never touches:
  - training/model.pkl, training/vectorizer.pkl, training/labelEncoder.pkl
    (the legacy fixed artifacts -- entirely outside training/models/ and
    never referenced by this module's deletion logic at all)
  - training/models/active.json's CONTENTS (only ever read, never written
    or deleted, by this module)
  - a candidate bundle's own file contents (deletion is always "remove
    the entire versioned directory", never an edit of what's inside it)

Configuration (env vars, conservative defaults):
    ML_MODEL_RETENTION_COUNT           (default 5)  -- how many
        validated-but-not-currently-active bundles to keep, newest first.
    ML_REJECTED_MODEL_RETENTION_COUNT  (default 3)  -- how many
        failed-validation/failed-activation bundles to keep, newest first.
    ML_MODEL_RETENTION_DAYS            (default 7)  -- minimum age (from
        the bundle's own recorded creation time) before ANY bundle may be
        deleted, regardless of classification or count. Read fresh from
        the environment on every call, never cached, so operators/tests
        can change it without reimporting this module.
"""

import os
import shutil
import datetime

from training import model_bundle
from observability import log_event, sanitize_reason

DEFAULT_MODEL_RETENTION_COUNT = 5
DEFAULT_REJECTED_MODEL_RETENTION_COUNT = 3
DEFAULT_MODEL_RETENTION_DAYS = 7

IN_PROGRESS_STATUSES = ("running", "evaluating", "activating")

# Classification labels -- see the module docstring / Phase F spec item 12.
ACTIVE = "active"
ROLLBACK_PROTECTED = "rollback-protected"
IN_PROGRESS = "in-progress"
VALIDATED_NOT_ACTIVATED = "validated-not-activated"
FAILED_VALIDATION = "failed-validation"
FAILED_ACTIVATION = "failed-activation"
ORPHANED = "orphaned"
UNKNOWN = "unknown"

# Classifications never eligible for deletion under any count/age policy.
NEVER_DELETE = {ACTIVE, ROLLBACK_PROTECTED, IN_PROGRESS, UNKNOWN}


def _env_int(name, default):
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _retention_count():
    return _env_int("ML_MODEL_RETENTION_COUNT", DEFAULT_MODEL_RETENTION_COUNT)


def _rejected_retention_count():
    return _env_int("ML_REJECTED_MODEL_RETENTION_COUNT", DEFAULT_REJECTED_MODEL_RETENTION_COUNT)


def _retention_days():
    return _env_int("ML_MODEL_RETENTION_DAYS", DEFAULT_MODEL_RETENTION_DAYS)


def _list_bundle_dirs():
    """
    Every immediate subdirectory of training/models/ that looks like a
    real bundle directory -- excludes active.json (a file, not a
    directory) and any leftover ".tmp-*" temp directories from an
    interrupted write_bundle/write_manifest call (see model_bundle.py;
    those are never valid bundles and are simply skipped here, not
    deleted -- an interrupted write's own cleanup is model_bundle.py's
    responsibility, not this module's).
    """
    if not os.path.isdir(model_bundle.MODELS_DIR):
        return []
    names = []
    for entry in os.scandir(model_bundle.MODELS_DIR):
        if not entry.is_dir(follow_symlinks=False):
            continue
        if entry.name.startswith(".tmp-"):
            continue
        names.append(entry.name)
    return names


def _bundle_age_days(model_version):
    """
    Age in days, sourced from the bundle's own metadata.json `createdAt`
    field when readable (authoritative -- this is when the bundle was
    actually produced), falling back to the directory's filesystem mtime
    only when metadata cannot be read at all (a malformed/incomplete
    bundle) -- directory age is never preferred over recorded metadata,
    only used as a fallback per the Phase F spec's "do not infer deletion
    safety from directory age alone" (age is still a REQUIRED input, just
    never the ONLY one, and metadata is trusted first when available).
    """
    try:
        metadata = model_bundle.read_metadata(model_version)
        created_at = metadata.get("createdAt")
        if created_at:
            created = datetime.datetime.fromisoformat(created_at.rstrip("Z"))
            return (datetime.datetime.utcnow() - created).total_seconds() / 86400.0
    except Exception:
        pass

    try:
        mtime = os.path.getmtime(model_bundle.bundle_dir(model_version))
        return (datetime.datetime.utcnow().timestamp() - mtime) / 86400.0
    except OSError:
        return 0.0  # cannot determine age at all -- treat as "just created" (never eligible)


def classify_bundles(get_run_for_model_version, find_runs_by_status):
    """
    Classifies every bundle directory under training/models/.

    `get_run_for_model_version` / `find_runs_by_status` are injected
    (normally db.training_run_repository's own functions) rather than
    imported directly, keeping this module's only hard dependency on
    MongoDB explicit and swappable for tests -- the same
    dependency-injection convention already used by
    db.feedback_repository.reconcile_reserved_feedback.

    Returns a dict: {model_version: {"classification": ..., "ageDays": ...,
                                       "run": <serialized run or None>}}
    """
    try:
        manifest = model_bundle.read_manifest()
    except model_bundle.ManifestError:
        manifest = None

    active_version = manifest.get("modelVersion") if manifest else None
    previous_version = manifest.get("previousModelVersion") if manifest else None

    in_progress_versions = set()
    for run in find_runs_by_status(IN_PROGRESS_STATUSES):
        if run.get("modelVersion"):
            in_progress_versions.add(run["modelVersion"])

    retention_days = _retention_days()
    results = {}

    for model_version in _list_bundle_dirs():
        age_days = _bundle_age_days(model_version)

        if model_version == active_version:
            classification = ACTIVE
        elif previous_version and model_version == previous_version:
            classification = ROLLBACK_PROTECTED
        elif model_version in in_progress_versions:
            classification = IN_PROGRESS
        else:
            run = get_run_for_model_version(model_version)
            if run is None:
                classification = ORPHANED if age_days >= retention_days else UNKNOWN
            else:
                status = run.get("status")
                if status in IN_PROGRESS_STATUSES:
                    classification = IN_PROGRESS
                elif status == "failed_validation":
                    classification = FAILED_VALIDATION
                elif status == "failed_activation":
                    classification = FAILED_ACTIVATION
                elif status in ("completed", "activated"):
                    # A superseded-but-once-good model (not the current active/previous version); treated like a validated, never-activated candidate.
                    classification = VALIDATED_NOT_ACTIVATED
                else:
                    classification = UNKNOWN

            results[model_version] = {
                "classification": classification,
                "ageDays": age_days,
                "run": run,
            }
            continue

        results[model_version] = {
            "classification": classification,
            "ageDays": age_days,
            "run": None,
        }

    return results


def _bundle_sort_key(item):
    """Newest first. Prefers the run's own createdAt when available (more
    reliable than filesystem mtime); falls back to age_days (smaller
    age_days = newer)."""
    model_version, info = item
    run = info.get("run")
    if run and run.get("createdAt"):
        return run["createdAt"]
    # No run record to sort by -- treat as oldest within its classification group.
    return datetime.datetime.min


def plan_cleanup(get_run_for_model_version, find_runs_by_status):
    """
    Produces a cleanup PLAN (never deletes anything itself -- see
    execute_cleanup for that). Returns:

        {
          "candidates": [{"modelVersion": ..., "classification": ...,
                            "action": "delete"|"keep", "reason": ...}, ...],
          "summary": {"delete": N, "keep": N},
        }

    Retention logic, applied per classification group:
      - ACTIVE / ROLLBACK_PROTECTED / IN_PROGRESS / UNKNOWN: always "keep"
        (NEVER_DELETE) -- no count or age reasoning ever overrides this.
      - VALIDATED_NOT_ACTIVATED: keep the newest ML_MODEL_RETENTION_COUNT;
        older ones are "delete" candidates ONLY if also past
        ML_MODEL_RETENTION_DAYS (the age floor applies universally).
      - FAILED_VALIDATION / FAILED_ACTIVATION: pooled together (both are
        "training produced a candidate nobody will ever use"), keep the
        newest ML_REJECTED_MODEL_RETENTION_COUNT combined; older ones are
        "delete" candidates, again only past the age floor.
      - ORPHANED: already gated to be past ML_MODEL_RETENTION_DAYS by
        classify_bundles itself (an orphaned bundle younger than that is
        classified UNKNOWN instead, and therefore never deleted here) --
        always a "delete" candidate.
    """
    classification_map = classify_bundles(get_run_for_model_version, find_runs_by_status)
    retention_days = _retention_days()
    retention_count = _retention_count()
    rejected_retention_count = _rejected_retention_count()

    candidates = []

    def _emit(model_version, classification, action, reason):
        candidates.append({
            "modelVersion": model_version,
            "classification": classification,
            "action": action,
            "reason": reason,
        })

    validated_group = []
    rejected_group = []
    orphaned_group = []

    for model_version, info in classification_map.items():
        classification = info["classification"]
        if classification in NEVER_DELETE:
            _emit(model_version, classification, "keep", f"protected ({classification})")
        elif classification == VALIDATED_NOT_ACTIVATED:
            validated_group.append((model_version, info))
        elif classification in (FAILED_VALIDATION, FAILED_ACTIVATION):
            rejected_group.append((model_version, info))
        elif classification == ORPHANED:
            orphaned_group.append((model_version, info))
        else:
            _emit(model_version, classification, "keep", "unrecognized classification, kept conservatively")

    def _apply_count_policy(group, keep_count, age_floor_days):
        group_sorted = sorted(group, key=_bundle_sort_key, reverse=True)
        for index, (model_version, info) in enumerate(group_sorted):
            classification = info["classification"]
            if index < keep_count:
                _emit(model_version, classification, "keep",
                      f"within retention count ({index + 1}/{keep_count})")
            elif info["ageDays"] < age_floor_days:
                _emit(model_version, classification, "keep",
                      f"younger than retention age floor ({info['ageDays']:.1f}d < {age_floor_days}d)")
            else:
                _emit(model_version, classification, "delete",
                      f"beyond retention count ({index + 1} > {keep_count}) and age floor")

    _apply_count_policy(validated_group, retention_count, retention_days)
    _apply_count_policy(rejected_group, rejected_retention_count, retention_days)

    for model_version, info in orphaned_group:
        # Defensive re-check: classify_bundles already gates ORPHANED on age, but a stale classification map could bypass it.
        if info["ageDays"] >= retention_days:
            _emit(model_version, ORPHANED, "delete", "no owning run record, past retention age")
        else:
            _emit(model_version, ORPHANED, "keep", "no owning run record, but too young to delete")

    delete_count = sum(1 for c in candidates if c["action"] == "delete")
    keep_count_total = len(candidates) - delete_count

    return {
        "candidates": candidates,
        "summary": {"delete": delete_count, "keep": keep_count_total},
    }


def _is_safe_child_path(target_dir):
    """
    Path-safety check (Phase F item 13): the resolved deletion target must
    be a DIRECT child of the resolved models root, and must not itself be
    a symlink -- refuses to follow a symlink that could point anywhere
    else on the filesystem. Returns True only when it is safe to proceed.
    """
    if os.path.islink(target_dir):
        return False
    real_root = os.path.realpath(model_bundle.MODELS_DIR)
    real_target = os.path.realpath(target_dir)
    return os.path.dirname(real_target) == real_root


def execute_cleanup(plan, dry_run=True):
    """
    Executes (or, if dry_run, merely reports) the deletions in `plan`
    (normally the return value of plan_cleanup).

    Safety guarantees (Phase F item 13):
      - dry_run=True performs NO filesystem changes at all -- it only
        echoes back what WOULD be deleted.
      - Immediately before each individual deletion, active.json is
        re-read fresh; if it now points at the candidate being deleted
        (e.g. a retrain activated it in the time between planning and
        applying), that one deletion is aborted and logged as skipped --
        the rest of the plan continues unaffected.
      - The resolved target must be a direct child of the models root and
        must not be a symlink (see _is_safe_child_path) -- otherwise
        skipped and logged, rest of the plan continues.
      - A missing target directory is treated as an idempotent no-op (already
        gone), not an error.
      - One directory's deletion failure (e.g. a permissions error) is
        caught per-directory and logged; it never aborts the remaining
        plan and never touches any other (protected or candidate)
        directory.

    Returns:
        {"deleted": [...], "skipped": [...], "errors": [...]}
    """
    deleted, skipped, errors = [], [], []

    delete_candidates = [c for c in plan.get("candidates", []) if c["action"] == "delete"]

    if dry_run:
        for candidate in delete_candidates:
            skipped.append({"modelVersion": candidate["modelVersion"], "reason": "dry run"})
        log_event("artifact_cleanup", dryRun=True, candidateCount=len(delete_candidates))
        return {"deleted": [], "skipped": skipped, "errors": []}

    for candidate in delete_candidates:
        model_version = candidate["modelVersion"]
        target_dir = model_bundle.bundle_dir(model_version)

        try:
            current_manifest = model_bundle.read_manifest()
        except model_bundle.ManifestError:
            current_manifest = None

        if current_manifest and current_manifest.get("modelVersion") == model_version:
            skipped.append({"modelVersion": model_version, "reason": "became active before deletion"})
            continue

        if not _is_safe_child_path(target_dir):
            skipped.append({"modelVersion": model_version, "reason": "unsafe path (symlink or not a direct child)"})
            continue

        if not os.path.isdir(target_dir):
            skipped.append({"modelVersion": model_version, "reason": "already missing (idempotent no-op)"})
            continue

        try:
            shutil.rmtree(target_dir)
            deleted.append(model_version)
        except Exception as exc:
            errors.append({"modelVersion": model_version, "error": sanitize_reason(str(exc))})

    log_event(
        "artifact_cleanup", dryRun=False,
        deletedCount=len(deleted), skippedCount=len(skipped), errorCount=len(errors),
    )
    return {"deleted": deleted, "skipped": skipped, "errors": errors}


def run_cleanup(get_run_for_model_version, find_runs_by_status, dry_run=True):
    """
    Convenience entry point combining plan_cleanup + execute_cleanup --
    the function app.py's activation workflow (or a manual/internal
    invocation) calls. Never raises: any unexpected exception anywhere in
    planning/execution is caught here and returned as a structured error
    rather than propagating into the caller's own control flow (the
    Phase F spec requires cleanup failure to never affect activation or
    feedback state).
    """
    try:
        plan = plan_cleanup(get_run_for_model_version, find_runs_by_status)
        result = execute_cleanup(plan, dry_run=dry_run)
        result["plan"] = plan
        return result
    except Exception as exc:
        sanitized = sanitize_reason(str(exc))
        log_event("artifact_cleanup", level=40, dryRun=dry_run, failureType=sanitized)
        return {"deleted": [], "skipped": [], "errors": [{"error": sanitized}], "plan": None}
