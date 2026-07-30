"""
[MULTI-PROCESS] Two independent OS processes sharing one model root and one
active.json (Phase G item 8).

NOT EXECUTED in the sandboxed agent environment used for this project:
requires real joblib/scikit-learn, same blocker as
tests/process/test_process_restart.py. Skips via `pytest.importorskip`.

Each "worker" here is a genuinely separate `python -c ...` subprocess, not
a thread and not two objects in one interpreter -- the in-process,
multiple-PredictorManager-objects version of this same guarantee already
ran for real (mocked dependencies) as Phase E's verify_phase_e.py
[MULTI-WORKER] sections 6-8, which this file does not repeat.

Records the observed reload delay relative to
ML_MANIFEST_CHECK_INTERVAL_SECONDS as the acceptance criterion for item 8's
"record the observed reload delay" requirement.
"""

import json
import os
import subprocess
import sys
import time

import pytest

pytest.importorskip("sklearn", reason="scikit-learn is not installed in this environment")
pytest.importorskip("joblib", reason="joblib is not installed in this environment")

ML_SERVICE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _worker_snapshot_after_wait(model_root, wait_seconds, check_interval):
    code = (
        "import os, sys, json, time\n"
        f"sys.path.insert(0, {ML_SERVICE!r})\n"
        f"os.environ['ML_MODEL_ROOT'] = {model_root!r}\n"
        f"os.environ['ML_MANIFEST_CHECK_INTERVAL_SECONDS'] = {str(check_interval)!r}\n"
        "import training.model_bundle as model_bundle\n"
        f"model_bundle.MODELS_DIR = {model_root!r}\n"
        "import inference.predictor_manager as pm\n"
        # Worker has no legacy artifacts on purpose -- it must start directly from the manifest.
        "mgr = pm.PredictorManager(); mgr.initialize()\n"
        f"time.sleep({wait_seconds})\n"
        "snap = mgr.get_snapshot()\n"
        "print(json.dumps({'version': snap.modelVersion, 'generation': snap.manifestGeneration}))\n"
    )
    proc = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout.strip().splitlines()[-1])


def test_worker_b_detects_and_reloads_after_worker_a_activates(tmp_path):
    import joblib
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.preprocessing import LabelEncoder
    from sklearn.ensemble import RandomForestClassifier

    model_root = str(tmp_path / "models")
    os.makedirs(model_root, exist_ok=True)

    import training.model_bundle as model_bundle
    import importlib
    importlib.reload(model_bundle)
    model_bundle.MODELS_DIR = model_root

    def _write_bundle(version, seed):
        texts = ["pizza", "uber", "walmart"] * 10
        labels = ["Food", "Transport", "Groceries"] * 10
        vec = TfidfVectorizer().fit(texts)
        enc = LabelEncoder().fit(labels)
        model = RandomForestClassifier(n_estimators=5, random_state=seed).fit(vec.transform(texts), enc.transform(labels))
        meta = model_bundle.build_metadata(
            run_id=f"run-{version}", model_version=version, dataset_snapshot_path="/tmp/x",
            dataset_hash=f"hash-{version}", row_counts={"total": 30}, model_type="RandomForestClassifier",
            vectorizer_type="TfidfVectorizer", encoder_classes=list(enc.classes_), metrics={"accuracy": 0.9},
        )
        model_bundle.write_bundle(version, model, vec, enc, meta)

    _write_bundle("model-v1", seed=1)
    manifest_v1 = model_bundle.build_manifest(
        model_version="model-v1", run_id="run-model-v1", artifact_path=model_bundle.bundle_dir("model-v1"),
        dataset_hash="hash-model-v1", previous_model_version=model_bundle.LEGACY_VERSION, generation=1,
    )
    model_bundle.write_manifest(manifest_v1)

    check_interval = 1
    # Worker A: starts, immediately observes generation 1.
    worker_a_start = _worker_snapshot_after_wait(model_root, wait_seconds=0, check_interval=check_interval)
    assert worker_a_start["version"] == "model-v1"

    # Simulate Worker A activating a new candidate (generation 2) while Worker B is mid-sleep.
    _write_bundle("model-v2", seed=2)
    manifest_v2 = model_bundle.build_manifest(
        model_version="model-v2", run_id="run-model-v2", artifact_path=model_bundle.bundle_dir("model-v2"),
        dataset_hash="hash-model-v2", previous_model_version="model-v1", generation=2,
    )
    model_bundle.write_manifest(manifest_v2)

    reload_start = time.monotonic()
    worker_b_result = _worker_snapshot_after_wait(
        model_root, wait_seconds=check_interval + 1, check_interval=check_interval
    )
    observed_delay = time.monotonic() - reload_start

    assert worker_b_result["version"] == "model-v2"
    assert worker_b_result["generation"] == 2
    print(f"observed multi-process reload delay: {observed_delay:.2f}s "
          f"(ML_MANIFEST_CHECK_INTERVAL_SECONDS={check_interval}s)")
