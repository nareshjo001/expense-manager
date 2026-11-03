"""Versioned model artifact bundle module (Phase D)."""

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
    """Deterministic, collision-safe, filesystem-safe model version derived directly from the training run's own id."""
    return f"model-{run_id}"


def bundle_dir(model_version):
    """The one place bundle directory paths are computed."""
    return os.path.join(MODELS_DIR, model_version)


def artifact_path(model_version, filename):
    return os.path.join(bundle_dir(model_version), filename)


def is_bundle_complete(model_version):
    """Json exists and is non-empty."""
    directory = bundle_dir(model_version)
    if not os.path.isdir(directory):
        return False
    for filename in (*ARTIFACT_FILENAMES, METADATA_FILENAME):
        path = os.path.join(directory, filename)
        if not os.path.isfile(path) or os.path.getsize(path) == 0:
            return False
    return True


def write_bundle(model_version, model, vectorizer, encoder, metadata):
    """Writes a complete, immutable candidate bundle for `model_version`."""
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
    """Best-effort cleanup of an incomplete temporary bundle directory."""
    try:
        if os.path.isdir(temp_dir):
            shutil.rmtree(temp_dir, ignore_errors=True)
    except Exception:
        pass


def load_bundle(model_version):
    """Validation Gate 2 (loadability): load all three artifacts from a candidate directory."""
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
    """Json payload. - Timestamps are ISO-8601 (UTC, with a trailing "Z")."""
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
    """Raised for a manifest that exists but cannot be trusted -- malformed JSON, or missing required keys."""
    pass


REQUIRED_MANIFEST_KEYS = (
    "modelVersion", "runId", "artifactPath", "datasetHash",
    "publishedAt", "generation",
)


def manifest_path():
    """The one place the manifest's on-disk path is computed -- mirrors bundle_dir()'s role for bundle directories."""
    return os.path.join(MODELS_DIR, MANIFEST_FILENAME)


def build_manifest(model_version, run_id, artifact_path, dataset_hash,
                    previous_model_version, generation):
    """Json payload. py's background_retrain and this project's Phase E report), so the caller can safely derive the next generation from read_mani."""
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
    """Reads and returns the active manifest dict, or None if no manifest file exists yet (the normal pre-first-activation state -- callers must NOT treat this as an error)."""
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
    """Atomically writes `manifest` (a dict, normally from build_manifest) to manifest_path(), replacing whatever was there before."""
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
    """Best-effort removal of the manifest file -- used by the Phase E activation-rollback path for the specific case where NO previous manifest existed (first-ever activation attempt failed after publishing): there is nothing valid to restore, so the newly-published manifest is simply removed, returning the service to "no manifest -> load the legacy model" until a future activation succeeds."""
    try:
        path = manifest_path()
        if os.path.isfile(path):
            os.remove(path)
        return True
    except Exception:
        return False
