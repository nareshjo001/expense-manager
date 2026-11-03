"""Manual rollback tool ("break glass" operator script). py's own atomic manifest functions -- never reimplements manifest writing itself)."""

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
    """ManifestError already plays for manifest-read failures."""
    pass


def _list_bundle_dirs():
    """Tmp-*` directory from an interrupted write_bundle/write_manifest call."""
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
    """Json is actually readable."""
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
    """Reactivates an older, still-on-disk bundle as the live model by publishing a new manifest that points at it -- see this module's own docstring for exactly how live workers converge on the change afterward."""
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
