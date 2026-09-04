"""
ML-001-T06 -- manual rollback tool ("break glass" operator script).

Standalone library + CLI mirroring training/validate_model.py's shape
(importable functions, plus a main()/argparse CLI entry point) and
training/model_cleanup.py's operational conventions (reads/writes only
via training/model_bundle.py's own atomic manifest functions -- never
reimplements manifest writing itself).

WHY THIS IS A SCRIPT, NOT AN HTTP ENDPOINT
--------------------------------------------------------------------------
Rolling the live model back to an older, already-on-disk bundle is a
rare, high-stakes "break glass" action -- reactivating something that is
by definition NOT the newest validated candidate, on a genuinely live
production inference service. Every other write path this project
exposes over HTTP (/retrain-model, and ML-001-T06's own
/training-runs/{run_id}/approve and /reject) only ever moves the system
FORWARD along an audited, single-actor-at-a-time MongoDB-backed lock
(training_run_repository's training lock) that this project's whole
activation-safety design (see app.py's _attempt_activation) depends on.
Rollback moves the system BACKWARD, deliberately outside that lock and
outside any run's own lifecycle -- there is no "run" whose status this
action transitions, and no gate re-validates the target bundle's
behavior against the CURRENT dataset/feedback state before reactivating
it (it was already validated once, against whatever was current back
when it was first produced).

Exposing that as an always-on network endpoint would mean any caller
holding the operations token (a single shared secret, per
_require_operations_token) could revert a live model at any time, with
no additional confirmation and no requirement that the caller actually
have deploy/operator access to the host itself. Keeping it a script run
directly on/against the deployment (the same "operational script" model
this project already uses for training/model_cleanup.py's dry-run
inspection via a Python shell -- see RUNBOOK.md section 6) means
reactivating an old model requires the same access an operator already
needs to change other production configuration, not merely knowledge of
one shared HTTP header value. This is a deliberate scope boundary for
ML-001-T06, consistent with RUNBOOK.md's existing conventions -- not an
oversight.

HOW ACTIVATION HAPPENS
--------------------------------------------------------------------------
This is a pure filesystem-level operation: it writes a new
training/models/active.json (via model_bundle.build_manifest +
write_manifest, reusing those exactly rather than reimplementing
manifest writing) pointing at an already-complete, already-loadable
bundle. It does NOT touch any process's own in-memory predictor
snapshot (there usually isn't one in the process running this script --
it is normally run from an operator's own shell, not inside a live
worker process). Every live worker process picks up the change on its
own, independently, within ML_MANIFEST_CHECK_INTERVAL_SECONDS (default
5s) of the manifest write, via inference/predictor_manager.py's existing
get_snapshot() polling + lazy-reload mechanism -- the exact same
convergence mechanism every other worker already relies on to notice a
NORMAL forward activation it did not itself perform. No new notification
mechanism is introduced here.

USAGE
--------------------------------------------------------------------------
    cd training
    python3 rollback_model.py --list
    python3 rollback_model.py --model-version model-<runId> [--reason "..."]

(Also runnable as `python3 training/rollback_model.py ...` from the
ml-service root -- this file resolves its own imports relative to its own
location, not the current working directory.)

Both forms print a JSON result to stdout. `--list` never modifies
anything. `--model-version` performs the rollback and prints the same
summary dict rollback_to() returns (or `{"success": false, "error": ...}`
and a non-zero exit code, on refusal).
"""

import os
import sys
import json
import argparse

_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
_ML_SERVICE_ROOT = os.path.dirname(_CURRENT_DIR)
if _ML_SERVICE_ROOT not in sys.path:
    sys.path.insert(0, _ML_SERVICE_ROOT)

from training import model_bundle


class RollbackError(Exception):
    """
    Raised for every refusal/failure case rollback_to() reports, so
    callers (this module's own CLI, and any future caller) can catch
    exactly one exception type -- mirroring the role
    model_bundle.ManifestError already plays for manifest-read failures.
    """
    pass


def _list_bundle_dirs():
    """
    Mirrors training/model_cleanup.py's own `_list_bundle_dirs`: every
    immediate subdirectory of model_bundle.MODELS_DIR, excluding
    `active.json` (a file, not a directory) and any leftover `.tmp-*`
    directory from an interrupted write_bundle/write_manifest call.
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


def list_promotable_bundles():
    """
    Every on-disk bundle an operator could roll back to right now:
    complete (model_bundle.is_bundle_complete) AND its metadata.json is
    actually readable. Sorted newest-first by metadata.json's own
    `createdAt` (ISO-8601, the same field model_bundle.build_metadata
    always writes) -- a bundle with a missing/unreadable createdAt sorts
    LAST, never first, so a broken timestamp can never masquerade as
    "most recent".

    Returns a list of dicts:
        {"modelVersion", "runId", "createdAt", "datasetHash", "metrics"}

    Never raises for one individual bad bundle: a directory that is
    "complete" per the cheap existence/non-empty check but whose
    metadata.json is corrupt JSON is simply omitted, since this
    function's whole job is "what CAN I roll back to right now", and an
    unreadable metadata file makes that bundle not a safe answer to that
    question regardless of what is_bundle_complete reports.
    """
    bundles = []
    for model_version in _list_bundle_dirs():
        if not model_bundle.is_bundle_complete(model_version):
            continue
        try:
            metadata = model_bundle.read_metadata(model_version)
        except (OSError, ValueError, json.JSONDecodeError):
            continue
        bundles.append({
            "modelVersion": model_version,
            "runId": metadata.get("runId"),
            "createdAt": metadata.get("createdAt"),
            "datasetHash": metadata.get("datasetHash"),
            "metrics": metadata.get("metrics"),
        })
    bundles.sort(key=lambda b: b.get("createdAt") or "", reverse=True)
    return bundles


def rollback_to(model_version, reason=None):
    """
    Reactivates an older, still-on-disk bundle as the live model by
    publishing a new manifest that points at it -- see this module's own
    docstring for exactly how live workers converge on the change
    afterward.

    Refuses (raises RollbackError, changes nothing on disk) when:
      - the current active.json exists but is invalid/unreadable -- an
        operator should inspect that manually before this tool guesses
        at a "previous" version to record.
      - `model_version` is already the currently-active one per
        model_bundle.read_manifest() -- nothing to do.
      - the bundle is not complete (model_bundle.is_bundle_complete is
        False) -- names exactly which directory was checked.
      - the bundle's metadata.json cannot be read.
      - model_bundle.load_bundle(model_version) raises -- the same
        Gate-2 loadability check the forward activation path
        (_attempt_activation -> predictor_manager.preload_candidate)
        already relies on, applied here to the ROLLBACK target so a
        broken-but-"complete" bundle can never be published as active.

    On success, publishes the new manifest via model_bundle.build_manifest
    + model_bundle.write_manifest (reused exactly, never reimplemented)
    and returns:
        {
            "fromModelVersion": <str or None>,
            "toModelVersion": <str>,
            "generation": <int>,
            "publishedAt": <str, ISO-8601>,
            "reason": <str or None>,
        }

    `fromModelVersion` is None only when there was no previous manifest at
    all (the very first activation of any kind is happening via this
    rollback path) -- in that case `generation` is 1, matching
    build_manifest's own convention for a first-ever publish.
    """
    try:
        current_manifest = model_bundle.read_manifest()
    except model_bundle.ManifestError as exc:
        raise RollbackError(
            f"the current active.json is invalid and cannot be trusted "
            f"({exc}) -- refusing to roll back until it is inspected manually"
        ) from exc

    current_version = current_manifest["modelVersion"] if current_manifest else None
    if current_version == model_version:
        raise RollbackError(
            f"{model_version!r} is already the active model -- nothing to roll back"
        )

    if not model_bundle.is_bundle_complete(model_version):
        expected = model_bundle.ARTIFACT_FILENAMES + (model_bundle.METADATA_FILENAME,)
        raise RollbackError(
            f"bundle {model_version!r} is not complete under "
            f"{model_bundle.bundle_dir(model_version)!r} (expected every one "
            f"of {expected} to exist and be non-empty) -- refusing to roll "
            f"back to an incomplete bundle"
        )

    try:
        metadata = model_bundle.read_metadata(model_version)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise RollbackError(
            f"bundle {model_version!r}'s metadata.json could not be read: {exc}"
        ) from exc

    try:
        model_bundle.load_bundle(model_version)
    except Exception as exc:
        raise RollbackError(
            f"bundle {model_version!r} failed to load (Gate 2 loadability "
            f"check) -- refusing to activate a bundle that cannot itself be "
            f"loaded: {exc}"
        ) from exc

    run_id = metadata.get("runId")
    dataset_hash = metadata.get("datasetHash")
    next_generation = (current_manifest.get("generation", 0) if current_manifest else 0) + 1

    new_manifest = model_bundle.build_manifest(
        model_version=model_version,
        run_id=run_id,
        artifact_path=model_bundle.bundle_dir(model_version),
        dataset_hash=dataset_hash,
        previous_model_version=(current_version or model_bundle.LEGACY_VERSION),
        generation=next_generation,
    )
    model_bundle.write_manifest(new_manifest)

    return {
        "fromModelVersion": current_version,
        "toModelVersion": model_version,
        "generation": next_generation,
        "publishedAt": new_manifest["publishedAt"],
        "reason": reason,
    }


def main():
    parser = argparse.ArgumentParser(
        description="ML-001-T06 break-glass rollback: reactivate an older, "
                     "already-on-disk model bundle by publishing a new manifest."
    )
    parser.add_argument(
        "--list", action="store_true",
        help="Print every currently promotable (complete, on-disk) bundle as JSON and exit. Never modifies anything.",
    )
    parser.add_argument(
        "--model-version", default=None,
        help="The bundle to roll back to, e.g. model-<runId>. See --list for choices.",
    )
    parser.add_argument(
        "--reason", default=None,
        help="Optional free-text operator note, echoed back in the printed result (not persisted anywhere else).",
    )
    args = parser.parse_args()

    if args.list:
        print(json.dumps(list_promotable_bundles(), indent=2))
        return

    if not args.model_version:
        parser.error("--model-version is required unless --list is given")

    try:
        result = rollback_to(args.model_version, reason=args.reason)
    except RollbackError as exc:
        print(json.dumps({"success": False, "error": str(exc)}, indent=2))
        sys.exit(1)

    print(json.dumps({"success": True, **result}, indent=2))


if __name__ == "__main__":
    main()
