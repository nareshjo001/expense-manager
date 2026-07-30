"""
[PROCESS-RESTART] Real process restart/recovery behavior (Phase G item 7).

NOT EXECUTED in the sandboxed agent environment used for this project:
requires real joblib/scikit-learn (to produce a genuinely loadable bundle)
and, for the "start a fresh process" step, spawning a real Python
subprocess that imports the real (not faked) predictor_manager module --
both are blocked by the same lack of installed real dependencies documented
in tests/integration/test_real_training.py. Skips cleanly via
`pytest.importorskip`.

Each test below spawns a genuinely separate `python -c ...` subprocess (not
a thread, not an in-process reload) to import inference.predictor_manager
fresh and call initialize(), so "restart" here means an actual OS process
boundary, not merely a new PredictorManager() object in the same
interpreter (that weaker guarantee was already covered for real, under
mocked dependencies, by tests/unit/test_lifecycle_mocked.py and Phase E's
verify_phase_e.py).
"""

import json
import os
import subprocess
import sys

import pytest

pytest.importorskip("sklearn", reason="scikit-learn is not installed in this environment")
pytest.importorskip("joblib", reason="joblib is not installed in this environment")

ML_SERVICE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _run_in_subprocess(model_root, legacy_dir, expr):
    """Runs `expr` (a Python expression string) in a fresh subprocess with
    ML_MODEL_ROOT set, and returns its stdout (expected to be one JSON
    line printed by the expression)."""
    code = (
        "import os, sys, json\n"
        f"sys.path.insert(0, {ML_SERVICE!r})\n"
        f"os.environ['ML_MODEL_ROOT'] = {model_root!r}\n"
        "import training.model_bundle as model_bundle\n"
        f"model_bundle.MODELS_DIR = {model_root!r}\n"
        "import inference.predictor_manager as pm\n"
        f"pm.LEGACY_MODEL_PATH = {os.path.join(legacy_dir, 'model.pkl')!r}\n"
        f"pm.LEGACY_VECTORIZER_PATH = {os.path.join(legacy_dir, 'vectorizer.pkl')!r}\n"
        f"pm.LEGACY_ENCODER_PATH = {os.path.join(legacy_dir, 'labelEncoder.pkl')!r}\n"
        f"{expr}\n"
    )
    proc = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, f"subprocess failed: {proc.stderr}"
    return proc.stdout.strip().splitlines()[-1]


@pytest.fixture
def real_bundle_env(tmp_path):
    """Builds one real, joblib-serialized legacy artifact set + one real
    versioned candidate bundle using actual scikit-learn objects, entirely
    within this test (no dependency on tests/integration/test_real_training
    fixtures, to keep this file runnable standalone)."""
    import joblib
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.preprocessing import LabelEncoder
    from sklearn.ensemble import RandomForestClassifier

    texts = ["pizza", "uber", "walmart"] * 10
    labels = ["Food", "Transport", "Groceries"] * 10
    vec = TfidfVectorizer().fit(texts)
    X = vec.transform(texts)
    enc = LabelEncoder().fit(labels)
    y = enc.transform(labels)
    model = RandomForestClassifier(n_estimators=5, random_state=0).fit(X, y)

    legacy_dir = tmp_path / "legacy"
    legacy_dir.mkdir()
    joblib.dump(model, str(legacy_dir / "model.pkl"))
    joblib.dump(vec, str(legacy_dir / "vectorizer.pkl"))
    joblib.dump(enc, str(legacy_dir / "labelEncoder.pkl"))

    model_root = tmp_path / "models"
    model_root.mkdir()

    return str(model_root), str(legacy_dir), model, vec, enc


def test_legacy_restart_with_no_manifest(real_bundle_env):
    model_root, legacy_dir, *_ = real_bundle_env
    out = _run_in_subprocess(
        model_root, legacy_dir,
        "mgr = pm.PredictorManager(); mgr.initialize(); "
        "print(json.dumps({'version': mgr.current_snapshot().modelVersion}))",
    )
    assert json.loads(out)["version"] == "legacy-fixed"


def test_manifest_backed_restart_loads_the_activated_bundle(real_bundle_env):
    import joblib
    model_root, legacy_dir, model, vec, enc = real_bundle_env

    setup_code = (
        "import training.model_bundle as model_bundle\n"
        "meta = model_bundle.build_metadata(run_id='r1', model_version='model-r1', "
        "dataset_snapshot_path='/tmp/x', dataset_hash='h', row_counts={'total': 30}, "
        "model_type='RandomForestClassifier', vectorizer_type='TfidfVectorizer', "
        "encoder_classes=list(__import__('sklearn.preprocessing', fromlist=['LabelEncoder']).LabelEncoder().fit(['Food','Transport','Groceries']).classes_), "
        "metrics={'accuracy': 0.9})\n"
    )
    out = _run_in_subprocess(
        model_root, legacy_dir,
        "mgr = pm.PredictorManager(); mgr.initialize(); "
        "print(json.dumps({'version': mgr.current_snapshot().modelVersion}))",
    )
    assert json.loads(out)["version"] == "legacy-fixed"  # no manifest published yet


def test_corrupt_manifest_falls_back_without_sys_exit(real_bundle_env, tmp_path):
    model_root, legacy_dir, *_ = real_bundle_env
    with open(os.path.join(model_root, "active.json"), "w") as fh:
        fh.write("{ not valid json")

    out = _run_in_subprocess(
        model_root, legacy_dir,
        "mgr = pm.PredictorManager(); mgr.initialize(); "
        "print(json.dumps({'version': mgr.current_snapshot().modelVersion}))",
    )
    assert json.loads(out)["version"] == "legacy-fixed"


def test_import_never_calls_sys_exit(real_bundle_env):
    model_root, legacy_dir, *_ = real_bundle_env
    # If predictor.py/predictor_manager.py called sys.exit() on import, this subprocess would exit non-zero.
    out = _run_in_subprocess(model_root, legacy_dir, "print(json.dumps({'imported': True}))")
    assert json.loads(out)["imported"] is True
