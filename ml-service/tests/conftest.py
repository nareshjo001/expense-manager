"""
Shared fixtures for ml-service's mocked-dependency UNIT tests.

These tests exercise REAL, unmodified production code (app.py,
predictor_manager.py, model_bundle.py, training_run_repository.py,
feedback_repository.py, model_cleanup.py) against FAKE joblib/pymongo/
bson/fastapi/pydantic modules -- used only when the real packages are not
installed, or when a test deliberately wants the lightweight fake instead
of a real (but slow/network-dependent) dependency.

IMPORTANT: tests using these fixtures must be labeled UNIT or FILESYSTEM,
never REAL-MONGODB or REAL-SKLEARN or FASTAPI -- see the Phase G
verification-category rules. tests/integration/, tests/process/, and
tests/contracts/ use the REAL packages (guarded by `pytest.importorskip`)
and skip cleanly when those packages are unavailable, rather than silently
falling back to these fakes.

Phase G pytest-harness-isolation fix -- two defects and their fixes:

  1. PicklingError ("Can't pickle <class 'conftest.FakeModel'>: it's not
     found as conftest.FakeModel"): FakeModel/FakeVectorizer/FakeEncoder
     used to be defined directly inside this file, and a SECOND, separate
     `conftest.py` (tests/unit/conftest.py) used to duplicate the exact
     same class definitions. Pytest imported both files under the same
     ambiguous top-level module name "conftest" (neither `tests/unit/` nor
     `tests/` had an `__init__.py`), so `sys.modules["conftest"]` could
     resolve to whichever file was imported LAST -- not necessarily the
     one that actually defined the pickled instance's class -- breaking
     pickle's `sys.modules[obj.__class__.__module__]` lookup on load.
     FIX: the duplicate `tests/unit/conftest.py` is deleted (this file is
     now the ONLY conftest.py that defines fixtures for the mocked test
     tiers), and the classes themselves moved to
     `tests/support/fake_ml_objects.py`, a real, unambiguous, dotted
     package path (see `tests/__init__.py` / `tests/support/__init__.py`)
     that pickle can resolve regardless of how many other conftest.py
     files pytest also loads in the same session.

  2. AttributeError ("module 'joblib' has no attribute 'Parallel'") when
     running tests/integration/test_real_training.py: this file used to
     call `_install_fakes()` UNCONDITIONALLY at its own module scope,
     which pytest executes during COLLECTION -- before any test or
     fixture runs, for every pytest invocation regardless of which tests
     were selected. That installed a fake `joblib` into `sys.modules`
     before scikit-learn (imported later, inside test_real_training.py)
     ever got a chance to see the real one. FIX: fake-module installation
     now happens EXCLUSIVELY inside the `mocked_lifecycle_env` fixture
     below, scoped to pytest's own `monkeypatch` fixture parameter, which
     pytest guarantees to undo at that fixture's teardown -- nothing is
     mutated in `sys.modules` merely by pytest importing this file.
"""

import os
import sys
import pickle
import shutil
import tempfile
import types

import pytest

# Path setup only -- safe at collection time since it never installs a fake module, only sys.path entries.
ML_SERVICE = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
for _p in (ML_SERVICE, os.path.join(ML_SERVICE, "training"), os.path.join(ML_SERVICE, "inference")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from tests.support.fake_ml_objects import (
    FakeModel, FakeVectorizer, FakeEncoder, make_pipeline,
)
from tests.support import fake_dependencies


@pytest.fixture
def mocked_lifecycle_env(monkeypatch):
    """
    Sets up a temp models directory + fake Mongo db and returns the real
    (reloaded) production modules wired against them: model_bundle, runs
    (db.training_run_repository), feedback (db.feedback_repository),
    predictor_manager module + a fresh PredictorManager instance, and
    app_module (app.py) with its module-level references patched to the
    same fakes -- mirroring the exact pattern used by
    outputs/verify_phase_e.py and outputs/verify_phase_f.py.

    Fake joblib/pymongo/bson/fastapi/pydantic are installed into
    `sys.modules` ONLY here, via `monkeypatch.setitem` -- pytest restores
    every one of those entries (deleting the key if it was absent before,
    or restoring the previous value if it was already imported for real)
    the instant this fixture's test finishes, regardless of whether the
    test passed or failed. No other module in this test suite is allowed
    to install these fakes at import time (see this file's own module
    docstring).
    """
    import importlib

    fake_dependencies.install_fake_dependencies(monkeypatch)

    tmp_root = tempfile.mkdtemp(prefix="ml-unit-")
    tmp_models = os.path.join(tmp_root, "models")
    os.makedirs(tmp_models, exist_ok=True)

    import training.model_bundle as model_bundle
    importlib.reload(model_bundle)
    monkeypatch.setattr(model_bundle, "MODELS_DIR", tmp_models)

    import training.model_validation  # noqa: F401
    importlib.reload(sys.modules["training.model_validation"])

    import inference.predictor_manager as pm_mod
    importlib.reload(pm_mod)
    monkeypatch.setattr(pm_mod, "model_bundle", model_bundle)

    tmp_legacy = os.path.join(tmp_root, "legacy")
    os.makedirs(tmp_legacy, exist_ok=True)
    legacy_model, legacy_vec, legacy_enc = make_pipeline()
    pickle.dump(legacy_model, open(os.path.join(tmp_legacy, "model.pkl"), "wb"))
    pickle.dump(legacy_vec, open(os.path.join(tmp_legacy, "vectorizer.pkl"), "wb"))
    pickle.dump(legacy_enc, open(os.path.join(tmp_legacy, "labelEncoder.pkl"), "wb"))
    # monkeypatch.setattr (not a direct assignment) so these paths are restored automatically at teardown.
    monkeypatch.setattr(pm_mod, "LEGACY_MODEL_PATH", os.path.join(tmp_legacy, "model.pkl"))
    monkeypatch.setattr(pm_mod, "LEGACY_VECTORIZER_PATH", os.path.join(tmp_legacy, "vectorizer.pkl"))
    monkeypatch.setattr(pm_mod, "LEGACY_ENCODER_PATH", os.path.join(tmp_legacy, "labelEncoder.pkl"))

    fake_db_module = types.ModuleType("db.mongo")
    db_instance = fake_dependencies.FakeDB()
    fake_db_module.get_db = lambda: db_instance
    fake_db_module.get_client = lambda: None
    monkeypatch.setitem(sys.modules, "db.mongo", fake_db_module)

    import db.training_run_repository as runs
    import db.feedback_repository as feedback
    importlib.reload(runs)
    importlib.reload(feedback)

    import training.model_cleanup as model_cleanup
    importlib.reload(model_cleanup)
    monkeypatch.setattr(model_cleanup, "model_bundle", model_bundle)

    import status_api
    importlib.reload(status_api)
    monkeypatch.setattr(status_api, "model_bundle", model_bundle)
    monkeypatch.setattr(status_api, "runs", runs)

    import app as app_module
    importlib.reload(app_module)
    monkeypatch.setattr(app_module, "runs", runs)
    monkeypatch.setattr(app_module, "feedback", feedback)
    monkeypatch.setattr(app_module, "model_bundle", model_bundle)
    monkeypatch.setattr(app_module, "model_cleanup", model_cleanup)
    monkeypatch.setattr(app_module, "status_api", status_api)

    manager = pm_mod.PredictorManager()
    manager.initialize()
    monkeypatch.setattr(app_module, "predictor_manager", manager)
    monkeypatch.setattr(pm_mod, "predictor_manager", manager)

    ctx = types.SimpleNamespace(
        tmp_root=tmp_root, model_bundle=model_bundle, runs=runs, feedback=feedback,
        model_cleanup=model_cleanup, status_api=status_api, app_module=app_module,
        predictor_manager=manager, make_pipeline=make_pipeline,
    )
    yield ctx

    # Undo explicitly before popping, so fake sys.modules entries are gone before pytest's own later undo runs.
    monkeypatch.undo()

    # Evicted so the next test re-imports clean modules instead of reusing these fixture-mutated objects.
    for name in (
        "app",
        "status_api",
        "inference.predictor",
        "inference.predictor_manager",
        "db.mongo",
        "db.training_run_repository",
        "db.feedback_repository",
        "training.model_bundle",
        "training.model_validation",
        "training.model_cleanup",
        "training.retrain_pipeline",
        "training.dataset_builder",
    ):
        sys.modules.pop(name, None)

    shutil.rmtree(tmp_root, ignore_errors=True)


@pytest.fixture
def write_candidate(mocked_lifecycle_env):
    ctx = mocked_lifecycle_env

    def _write(model_version, run_id, dataset_hash="hash-1", categories=("Food", "Transport", "Groceries"), accuracy=0.9):
        model, vec, enc = ctx.make_pipeline(categories=categories)
        metadata = ctx.model_bundle.build_metadata(
            run_id=run_id, model_version=model_version,
            dataset_snapshot_path="/tmp/snap.csv", dataset_hash=dataset_hash,
            row_counts={"total": 10}, model_type="FakeModel",
            vectorizer_type="FakeVectorizer", encoder_classes=enc.classes_,
            metrics={"accuracy": accuracy},
        )
        return ctx.model_bundle.write_bundle(model_version, model, vec, enc, metadata)

    return _write
