"""
[REAL-SKLEARN] Real trainer.py run against a small, deterministic synthetic
dataset (Phase G item 5).

NOT EXECUTED in the sandboxed agent environment used for this project:
scikit-learn and joblib are not installed there and cannot be installed
(no outbound network access -- `pip install scikit-learn` fails with a
proxy/DNS error; confirmed during the Phase G pre-implementation audit).
`pytest.importorskip` makes this skip cleanly rather than error or fall
back to a mock in that environment. On a machine with the pinned
requirements.txt installed (e.g. the project's own ml-service/venv, or any
CI runner with network access), this executes for real against the actual
trainer.py subprocess.
"""

import os
import sys
import csv
import random
import tempfile

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from tests.support.dependency_checks import require_real_dependency

sklearn = pytest.importorskip("sklearn", reason="scikit-learn is not installed in this environment")
# require_real_dependency (not a bare importorskip) turns a shadowed/poisoned joblib into a hard failure.
joblib = require_real_dependency("joblib", required_attr="Parallel")


def test_real_joblib_is_not_shadowed():
    """
    Focused diagnostic (Phase G item 5): confirms `joblib` in THIS process
    is the real package, not one of this test suite's own fake stand-ins.
    Does not assert any specific (e.g. Windows) path -- only that the
    module has a real `__file__` (the fakes in tests/support/fake_dependencies.py
    never set one) and exposes `Parallel`, which the fakes never define.
    """
    import joblib as joblib_module

    assert hasattr(joblib_module, "Parallel")
    module_file = getattr(joblib_module, "__file__", None)
    assert module_file, "joblib has no __file__ -- this is a fake/stub module, not the real package"
    assert os.path.isfile(module_file)
    # Must not resolve into this test suite's own fake-module support package.
    assert "tests" + os.sep + "support" not in os.path.abspath(module_file)

CATEGORIES = {
    "Food": ["pizza hut", "starbucks coffee", "grocery store", "mcdonalds", "local bakery"],
    "Transport": ["uber ride", "gas station", "metro card", "taxi fare", "parking fee"],
    "Groceries": ["walmart", "whole foods", "costco", "trader joes", "safeway"],
    "Utilities": ["electric bill", "water bill", "internet service", "gas bill", "phone plan"],
}


def _build_synthetic_dataset(path, rows_per_category=40, seed=42):
    rng = random.Random(seed)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["expenseName", "expenseCategory"])
        for category, samples in CATEGORIES.items():
            for _ in range(rows_per_category):
                base = rng.choice(samples)
                suffix = rng.randint(1, 999)
                writer.writerow([f"{base} {suffix}", category])


@pytest.fixture
def synthetic_dataset(tmp_path):
    path = tmp_path / "synthetic_feedback.csv"
    _build_synthetic_dataset(str(path))
    return str(path)


def test_synthetic_dataset_has_enough_rows_per_category(synthetic_dataset):
    import pandas as pd
    df = pd.read_csv(synthetic_dataset)
    counts = df["expenseCategory"].value_counts()
    assert len(counts) >= 4
    assert counts.min() >= 30  # enough for a train/test split


def test_real_trainer_produces_a_loadable_versioned_bundle(synthetic_dataset, tmp_path, monkeypatch):
    """
    Invokes the REAL training/trainer.py as the subprocess it actually is
    in production (retrain_pipeline.py's own `_run_trainer` builds this
    exact argv shape -- mirrored here rather than reimplemented), against
    the synthetic dataset, then verifies the resulting bundle through
    model_bundle.py's own real loading + gate functions -- the same code
    path predictor_manager.py uses at runtime.

    Phase G acceptance-run fix (blocker 1): trainer.py runs in a SEPARATE
    OS process. Directly mutating `model_bundle.MODELS_DIR` (a plain
    Python attribute) in THIS process has no way to reach that subprocess
    -- the subprocess imports its own, fresh `model_bundle` module, which
    resolves `MODELS_DIR` from the `ML_MODEL_ROOT` environment variable
    (see training/model_bundle.py's Phase G item 9 change), not from
    anything this test process does to its own in-memory module object.
    The real bug this test previously had: it reloaded model_bundle here
    and pointed ITS OWN copy at tmp_path, while the actual trainer
    subprocess kept writing to the default location (no ML_MODEL_ROOT set
    in its environment at all) -- so `is_bundle_complete` against the
    test's own (correctly pointed) model_bundle object could never find
    what the subprocess actually wrote elsewhere.

    Fix: both this process AND the trainer subprocess derive MODELS_DIR
    from the SAME `ML_MODEL_ROOT` value -- `monkeypatch.setenv` (so a
    reload of model_bundle here picks it up via `os.getenv`) and an
    explicit `env=` dict passed to `subprocess.run` (so the child process
    -- which does not inherit Python attribute mutations, only OS
    environment variables -- resolves the identical path). This is not a
    trainer.py change: trainer.py already correctly derives its bundle
    location through model_bundle.py's existing environment-variable
    convention; the test was simply failing to propagate that same
    configuration into the subprocess it spawns.
    """
    import json
    import subprocess
    import importlib

    models_root = str(tmp_path / "models")
    monkeypatch.setenv("ML_MODEL_ROOT", models_root)

    import training.model_bundle as model_bundle
    importlib.reload(model_bundle)
    assert model_bundle.MODELS_DIR == models_root
    os.makedirs(model_bundle.MODELS_DIR, exist_ok=True)

    run_id = "integration-test-run"
    model_version = model_bundle.model_version_for_run(run_id)
    trainer_script = os.path.join(os.path.dirname(model_bundle.__file__), "trainer.py")
    result_path = str(tmp_path / "train-result.json")

    argv = [
        sys.executable, trainer_script,
        "--dataset", synthetic_dataset,
        "--run-id", run_id,
        "--model-version", model_version,
        "--dataset-hash", "integration-test-hash",
        "--row-counts-json", json.dumps({"total": 160}),
        "--result-path", result_path,
    ]
    # subprocess.run doesn't inherit in-memory attribute mutations, only OS env vars, so env= must carry ML_MODEL_ROOT.
    env = os.environ.copy()
    env["ML_MODEL_ROOT"] = models_root

    proc = subprocess.run(argv, env=env, capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, f"trainer.py failed: stderr={proc.stderr}"

    with open(result_path, encoding="utf-8") as fh:
        result = json.load(fh)
    assert result["success"] is True

    # Must resolve beneath the SAME models_root, proving the subprocess wrote where this test is looking.
    artifact_path = result.get("artifactPath")
    assert artifact_path, "trainer.py's result JSON did not report an artifactPath"
    assert os.path.commonpath([os.path.abspath(artifact_path), os.path.abspath(models_root)]) == os.path.abspath(models_root), (
        f"trainer subprocess wrote its candidate bundle to {artifact_path!r}, "
        f"which is NOT beneath the test's ML_MODEL_ROOT ({models_root!r}) -- "
        f"the subprocess environment propagation is broken."
    )

    assert model_bundle.MODELS_DIR == models_root
    assert model_bundle.is_bundle_complete(model_version)
    model, vectorizer, encoder = model_bundle.load_bundle(model_version)

    from training.model_validation import gate_smoke_predictions
    smoke = gate_smoke_predictions(model, vectorizer, encoder)
    assert smoke["passed"], smoke.get("reason")

    metadata = model_bundle.read_metadata(model_version)
    assert metadata["runId"] == run_id
    assert "accuracy" in (result.get("metrics") or metadata.get("metrics") or {})
