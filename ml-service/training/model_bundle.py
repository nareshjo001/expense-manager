"""
Versioned model artifact bundle module (Phase D).

Single shared module owning:
  - model version identifier generation (model_version_for_run)
  - the on-disk bundle directory layout (bundle_dir / artifact_path)
  - atomic-as-practical bundle writing (write_bundle)
  - artifact loading (load_bundle)
  - metadata construction/reading (build_metadata / read_metadata)
  - bundle completeness checks (is_bundle_complete)

Both training/trainer.py (via this module, in its own subprocess) and
training/model_validation.py (also via this module, in its own subprocess)
use this module today, so their expectations of "what a valid bundle looks
like" cannot drift apart. Phase E's inference/predictor_manager.py reuses
this same module for runtime loading rather than reimplementing its own
convention.

Phase E adds the active-model manifest (training/models/active.json) to
this module too -- ownership of "where is the manifest, how is it read and
atomically written" belongs in exactly one place, same reasoning as the
bundle layout itself. See write_manifest/read_manifest/remove_manifest and
build_manifest below. Publishing/rolling back a manifest is orchestrated by
app.py (which alone has MongoDB access); this module only knows how to
read/write the manifest FILE safely, never mutating bundle contents when it
does so.

This module deliberately imports only `joblib` and the standard library --
no MongoDB, no FastAPI -- so it can be imported cheaply from any of the
processes that touch it (the trainer subprocess, the validator subprocess,
and the main FastAPI process via predictor_manager.py) without pulling in
unrelated dependencies.
"""

import os
import json
import shutil
import platform
import tempfile
import datetime

import joblib

# Defaults to training/models if unset; when set, must be writable and on the same filesystem as this process.
MODELS_DIR = os.getenv("ML_MODEL_ROOT") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "models"
)

ARTIFACT_FILENAMES = ("model.pkl", "vectorizer.pkl", "labelEncoder.pkl")
METADATA_FILENAME = "metadata.json"
MANIFEST_FILENAME = "active.json"

# Used for the fixed legacy artifacts when no manifest exists yet; never collides with a real "model-<runId>".
LEGACY_VERSION = "legacy-fixed"


def model_version_for_run(run_id):
    """
    Deterministic, collision-safe, filesystem-safe model version derived
    directly from the training run's own id.

    "model-<runId>" was chosen over a sequence-style counter (e.g.
    model-v000042) because:
      - it requires no "read the current max, then increment" logic at all
        -- which would itself need its own atomic-claim mechanism (an extra
        moving part) to be race-safe across workers/replicas, exactly the
        class of problem Phase B already solved once for the training lock
        and shouldn't need solving again here.
      - run ids (MongoDB ObjectIds, already globally unique) make collision
        structurally impossible.
      - it is trivially traceable back to the exact training-run record
        that produced it -- no separate mapping table needed.
      - ObjectId hex strings are alphanumeric and filesystem-safe on both
        POSIX and Windows without any escaping.
    """
    return f"model-{run_id}"


def bundle_dir(model_version):
    """The one place bundle directory paths are computed. Every other
    module (trainer.py, model_validation.py, retrain_pipeline.py, and
    Phase E's future loader) must call this rather than rebuilding the path
    manually, so a layout change only ever needs to happen here."""
    return os.path.join(MODELS_DIR, model_version)


def artifact_path(model_version, filename):
    return os.path.join(bundle_dir(model_version), filename)


def is_bundle_complete(model_version):
    """
    Validation Gate 1 (completeness): every expected artifact file plus
    metadata.json exists and is non-empty. Does not attempt to
    load/deserialize anything -- that is Gate 2 (loadability), a separate,
    more expensive check performed by load_bundle.
    """
    directory = bundle_dir(model_version)
    if not os.path.isdir(directory):
        return False
    for filename in (*ARTIFACT_FILENAMES, METADATA_FILENAME):
        path = os.path.join(directory, filename)
        if not os.path.isfile(path) or os.path.getsize(path) == 0:
            return False
    return True


def write_bundle(model_version, model, vectorizer, encoder, metadata):
    """
    Writes a complete, immutable candidate bundle for `model_version`.

    Atomicity approach: the entire bundle (three joblib artifacts plus
    metadata.json) is first written into a PRIVATE temporary directory
    created as a sibling of MODELS_DIR (via tempfile.mkdtemp(dir=MODELS_DIR)
    -- deliberately NOT the OS's global temp directory, which could be a
    different mounted filesystem/volume, especially in a container). Only
    once every file has been written and fsync'd is the temporary directory
    atomically renamed to its final `bundle_dir(model_version)` path via
    os.rename.

    Platform behavior: os.rename() is a single, atomic filesystem operation
    on both POSIX (a single rename(2) syscall) and Windows (a single
    MoveFileEx call), PROVIDED source and destination are on the same
    filesystem/volume -- guaranteed here because the temp directory is a
    sibling of the final directory's parent. There is no intermediate state
    in which a reader can observe a partially-renamed directory: until the
    rename call returns, nothing exists at the final path at all; the
    instant it returns, the complete bundle exists there. This is why no
    separate ".complete" marker file is needed on top of the rename itself
    -- the rename IS the atomic completion signal. (A marker-file scheme
    would only be necessary if directory rename were not available/atomic
    on a target platform, which is not the case for Windows or Linux.)

    If `bundle_dir(model_version)` already exists, this raises immediately
    without touching it -- a version directory belongs to exactly one
    training run and is never reused or overwritten.

    The existing fixed model.pkl / vectorizer.pkl / labelEncoder.pkl files
    at training/ root -- what predictor.py actually reads -- are never
    written to by this function. Candidate bundle creation cannot affect
    the live model.

    Raises on any failure; on failure, the private temp directory is
    removed (best-effort) and the caller can be certain no valid or
    partially-valid directory exists at the final path.
    """
    os.makedirs(MODELS_DIR, exist_ok=True)
    final_dir = bundle_dir(model_version)

    if os.path.exists(final_dir):
        raise RuntimeError(
            f"bundle already exists for {model_version} -- refusing to overwrite"
        )

    temp_dir = tempfile.mkdtemp(prefix=f".tmp-{model_version}-", dir=MODELS_DIR)
    try:
        joblib.dump(model, os.path.join(temp_dir, "model.pkl"))
        joblib.dump(vectorizer, os.path.join(temp_dir, "vectorizer.pkl"))
        joblib.dump(encoder, os.path.join(temp_dir, "labelEncoder.pkl"))

        metadata_path = os.path.join(temp_dir, METADATA_FILENAME)
        with open(metadata_path, "w", encoding="utf-8") as fh:
            json.dump(metadata, fh, indent=2, sort_keys=True)
            fh.flush()
            os.fsync(fh.fileno())

        os.rename(temp_dir, final_dir)
    except Exception:
        remove_temp_bundle(temp_dir)
        raise

    return final_dir


def remove_temp_bundle(temp_dir):
    """
    Best-effort cleanup of an incomplete temporary bundle directory. Never
    raises -- a cleanup failure here must not mask or replace the original
    error that triggered it. If cleanup itself fails, the orphaned temp
    directory (named with a `.tmp-` prefix, distinguishable from any real
    version directory) is simply left behind for manual/later inspection;
    it can never be mistaken for a valid bundle since is_bundle_complete
    only ever looks at `bundle_dir(model_version)` paths, never `.tmp-`
    paths.
    """
    try:
        if os.path.isdir(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
    except Exception:
        pass


def load_bundle(model_version):
    """
    Validation Gate 2 (loadability): load all three artifacts from a
    candidate directory. Raises on any deserialization failure -- callers
    must treat any exception here as "reject the bundle", never attempt a
    partial/best-effort load.

    Returns (model, vectorizer, encoder).
    """
    directory = bundle_dir(model_version)
    model = joblib.load(os.path.join(directory, "model.pkl"))
    vectorizer = joblib.load(os.path.join(directory, "vectorizer.pkl"))
    encoder = joblib.load(os.path.join(directory, "labelEncoder.pkl"))
    return model, vectorizer, encoder


def read_metadata(model_version):
    directory = bundle_dir(model_version)
    with open(os.path.join(directory, METADATA_FILENAME), encoding="utf-8") as fh:
        return json.load(fh)


def build_metadata(
    run_id,
    model_version,
    dataset_snapshot_path,
    dataset_hash,
    row_counts,
    model_type,
    vectorizer_type,
    encoder_classes,
    metrics,
):
    """
    Builds the JSON-serializable metadata.json payload.

    - Timestamps are ISO-8601 (UTC, with a trailing "Z").
    - encoder_classes is stored sorted (deterministic order) as plain
      strings -- this also happens to match scikit-learn's own LabelEncoder
      convention, whose `classes_` attribute is already alphabetically
      sorted after fit(), so this is not introducing a different ordering
      convention, just making it explicit and independent of whatever
      object type produced the list.
    - Nothing here originates from environment configuration/credentials --
      only run/dataset/model identifiers, row counts, and metrics.
    - pythonVersion / scikitLearnVersion / joblibVersion are included on a
      strict best-effort basis (each independently wrapped so a missing or
      oddly-packaged library cannot break metadata construction).
    """
    payload = {
        "runId": run_id,
        "modelVersion": model_version,
        "createdAt": datetime.datetime.utcnow().isoformat() + "Z",
        "datasetSnapshotPath": dataset_snapshot_path,
        "datasetHash": dataset_hash,
        "rowCounts": row_counts,
        "modelType": model_type,
        "vectorizerType": vectorizer_type,
        "encoderClasses": sorted(str(c) for c in encoder_classes),
        "metrics": metrics,
        "artifactFiles": list(ARTIFACT_FILENAMES),
    }

    try:
        payload["pythonVersion"] = platform.python_version()
    except Exception:
        pass

    try:
        import sklearn
        payload["scikitLearnVersion"] = sklearn.__version__
    except Exception:
        pass

    try:
        payload["joblibVersion"] = joblib.__version__
    except Exception:
        pass

    return payload


# Active-model manifest.
class ManifestError(Exception):
    """
    Raised for a manifest that exists but cannot be trusted -- malformed
    JSON, or missing required keys. Callers (predictor_manager.py, app.py's
    startup/reconciliation logic) must treat this distinctly from "no
    manifest file at all" (which read_manifest represents as returning
    None, not raising): a missing manifest is an expected, normal state
    (pre-first-activation); a present-but-broken manifest is an anomaly
    worth a controlled, logged error and a fallback decision, never a
    silent "treat as if reading a fresh field cured it" story that would
    reset the world back to the legacy model without a trace.
    """
    pass


REQUIRED_MANIFEST_KEYS = (
    "modelVersion", "runId", "artifactPath", "datasetHash",
    "publishedAt", "generation",
)


def manifest_path():
    """The one place the manifest's on-disk path is computed -- mirrors
    bundle_dir()'s role for bundle directories. Stored as a sibling of the
    versioned bundle directories (training/models/active.json), i.e. on the
    SAME filesystem as every bundle it can reference -- required for
    os.replace to be atomic (same-filesystem rename)."""
    return os.path.join(MODELS_DIR, MANIFEST_FILENAME)


def build_manifest(model_version, run_id, artifact_path, dataset_hash,
                    previous_model_version, generation):
    """
    Builds the JSON-serializable active.json payload. `generation` is a
    plain, caller-supplied monotonically increasing integer -- this module
    does not decide or track generation numbers itself, since only one
    retraining run can ever be publishing a manifest at a time (the
    MongoDB-backed training lock, held through the whole activation
    workflow -- see app.py's background_retrain and this project's Phase E
    report), so the caller can safely derive the next generation from
    read_manifest()'s current value without a race.
    """
    return {
        "modelVersion": model_version,
        "runId": run_id,
        "artifactPath": artifact_path,
        "datasetHash": dataset_hash,
        "publishedAt": datetime.datetime.utcnow().isoformat() + "Z",
        "previousModelVersion": previous_model_version,
        "generation": generation,
    }


def read_manifest():
    """
    Reads and returns the active manifest dict, or None if no manifest
    file exists yet (the normal pre-first-activation state -- callers must
    NOT treat this as an error).

    Raises ManifestError if a manifest file exists but is not valid JSON,
    or is valid JSON missing one or more REQUIRED_MANIFEST_KEYS. Never
    raises a raw JSONDecodeError/KeyError to the caller -- always this
    module's own exception type, so callers can catch exactly one thing.
    """
    path = manifest_path()
    if not os.path.isfile(path):
        return None

    try:
        with open(path, encoding="utf-8") as fh:
            manifest = json.load(fh)
    except (json.JSONDecodeError, OSError) as exc:
        raise ManifestError(f"manifest at {path} is not valid JSON: {exc}") from exc

    missing = [k for k in REQUIRED_MANIFEST_KEYS if k not in manifest]
    if missing:
        raise ManifestError(f"manifest at {path} is missing required key(s): {missing}")

    return manifest


def write_manifest(manifest):
    """
    Atomically writes `manifest` (a dict, normally from build_manifest) to
    manifest_path(), replacing whatever was there before.

    Same atomicity approach as write_bundle: the full JSON payload is
    written to a private temporary file IN THE SAME DIRECTORY as the final
    manifest path (tempfile.mkstemp(dir=MODELS_DIR)), flushed and fsync'd,
    then atomically substituted for the real path via os.replace. os.replace
    (unlike os.rename) is explicitly documented to succeed even if the
    destination already exists, on both POSIX and Windows -- which matters
    here because, unlike a brand-new bundle directory, the manifest path
    typically already has a previous, valid file at it that this call is
    meant to supersede.

    There is no window in which a reader can observe a partially-written
    manifest: right up until os.replace returns, `manifest_path()` still
    resolves to the complete previous file (or nothing, for the very first
    publish); the instant it returns, it resolves to the complete new file.
    A crash or process kill at any point before that instant leaves the
    previous manifest (or absence of one) completely untouched -- there is
    no "torn write" state to recover from.

    Never mutates any bundle directory's contents -- this function touches
    only the manifest file itself.

    Raises on failure (e.g. disk full while writing the temp file); the
    temp file is best-effort removed in that case so it can never be
    mistaken for anything.
    """
    os.makedirs(MODELS_DIR, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=".tmp-active-", suffix=".json", dir=MODELS_DIR)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, indent=2, sort_keys=True)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temp_path, manifest_path())
    except Exception:
        try:
            if os.path.isfile(temp_path):
                os.remove(temp_path)
        except Exception:
            pass
        raise


def remove_manifest():
    """
    Best-effort removal of the manifest file -- used by the Phase E
    activation-rollback path for the specific case where NO previous
    manifest existed (first-ever activation attempt failed after
    publishing): there is nothing valid to restore, so the newly-published
    manifest is simply removed, returning the service to "no manifest ->
    load the legacy model" until a future activation succeeds.

    Safe to call even if the manifest does not exist. Never raises --
    callers treat a failure to remove as a logged warning, not a reason to
    escalate a rollback failure into a bigger incident; a stale-but-invalid
    manifest left behind after a failed rollback-of-a-rollback is still
    something predictor_manager.py's startup/reload logic will reject via
    the same validation it always runs before trusting a manifest.
    """
    try:
        path = manifest_path()
        if os.path.isfile(path):
            os.remove(path)
        return True
    except Exception:
        return False
