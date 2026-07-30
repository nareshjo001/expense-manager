"""
[REAL-MONGODB + REAL-SKLEARN + FASTAPI] Full end-to-end retraining lifecycle
(Phase G item 6), exercised through FastAPI's own TestClient against a real
local Uvicorn-compatible app instance -- not by invoking background_retrain
directly.

NOT EXECUTED in the sandboxed agent environment used for this project: it
requires ALL THREE of a real MongoDB test database, real scikit-learn, and
real FastAPI/httpx, none of which are available there (no network to
install them, no local mongod binary, no outbound connectivity to the
configured Atlas cluster). `pytest.importorskip` plus the `real_test_db`
fixture make this skip cleanly rather than mock any of the three away --
see tests/unit/test_lifecycle_mocked.py for the mocked-equivalent of this
same lifecycle, which DID run for real (labeled UNIT, not REAL-MONGODB) as
part of Phase G.

Run (with a reachable test MongoDB and the pinned requirements installed):
    ML_TEST_MONGO_CONN=... ML_TEST_MONGO_DB_NAME=auth-db-ml-integration-test \\
    pytest tests/integration/test_end_to_end_retraining.py -v
"""

import os
import sys
import csv
import json
import random
import time

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

pytest.importorskip("sklearn", reason="scikit-learn is not installed in this environment")
pytest.importorskip("joblib", reason="joblib is not installed in this environment")

# RuntimeError from a missing HTTP-client dep is left uncaught here -- a config problem, not a reason to skip.
fastapi_testclient = pytest.importorskip(
    "fastapi.testclient", reason="fastapi is not installed in this environment"
)


def test_fastapi_testclient_is_importable():
    """
    [FASTAPI] Dependency sanity check (Phase G acceptance-run blocker 2).

    Distinguishes "fastapi itself is not installed" (a legitimate skip --
    handled by the module-level `pytest.importorskip` above, which runs
    before this test is even collected) from "fastapi is installed but
    `fastapi.testclient.TestClient` cannot actually be constructed because
    Starlette's own HTTP-client dependency is missing/incompatible" -- the
    latter must remain a hard, diagnosable failure. Since this test file
    only reaches this point at all when the module-level `importorskip`
    above already succeeded in importing `fastapi.testclient` itself, this
    test's job is to prove the class it exports is actually usable end to
    end (constructing a TestClient requires the underlying HTTP transport
    to be importable too, which a bare `import fastapi.testclient` does
    not by itself guarantee across every Starlette version).
    """
    from fastapi.testclient import TestClient
    from fastapi import FastAPI

    probe_app = FastAPI()

    try:
        with TestClient(probe_app) as c:
            pass
    except Exception as exc:
        raise AssertionError(
            f"fastapi.testclient.TestClient imported but could not be "
            f"constructed: {exc!r}. Run "
            f"`python -c \"import importlib.metadata as m; "
            f"print(m.version('starlette')); print(m.requires('starlette'))\"` "
            f"to find your installed Starlette version's actual HTTP-client "
            f"requirement, install the exact package/version it names, and "
            f"pin it in requirements-test.txt -- see that file's own note."
        ) from exc


OPERATIONS_TOKEN = "phase-g-integration-token"


@pytest.fixture
def clean_e2e_database(real_test_db):
    """
    Stale-state isolation fix (real Windows run): startup reconciliation
    logged "reconciled 17 queued run(s)" and "reserved 121 pending feedback
    document(s)" on entry to the TestClient -- proof this test was sharing
    leftover state from previous executions of this same dedicated test
    database, not a production defect. Cleared before AND after the test,
    via delete_many (never drop_database, preserving the "no drop_database"
    policy and all indexes) -- safe for the identical reason
    tests/integration/test_mongo_repositories.py's own cleanup fixture is
    safe: `real_test_db` already asserts `"test" in db_name.lower()` before
    this fixture (or any test depending on it) ever runs.
    """
    for name in ("mltraininglocks", "mltrainingruns", "mlfeedbacks"):
        real_test_db[name].delete_many({})
    yield
    for name in ("mltraininglocks", "mltrainingruns", "mlfeedbacks"):
        real_test_db[name].delete_many({})


@pytest.fixture
def client(clean_e2e_database, real_test_db, tmp_path, monkeypatch):
    # model_bundle resolves MODELS_DIR from ML_MODEL_ROOT at import time, so setenv alone isn't enough; reload too.
    models_root = str(tmp_path / "models")
    monkeypatch.setenv("ML_MODEL_ROOT", models_root)
    monkeypatch.setenv("MONGO_CONN", os.environ["ML_TEST_MONGO_CONN"])
    monkeypatch.setenv("MONGO_DB_NAME", os.environ["ML_TEST_MONGO_DB_NAME"])

    # status_api reads ML_OPERATIONS_TOKEN fresh per request, so setenv before the TestClient is enough.
    monkeypatch.setenv("ML_OPERATIONS_TOKEN", OPERATIONS_TOKEN)

    import importlib

    import db.mongo as mongo_module
    importlib.reload(mongo_module)
    monkeypatch.setattr(mongo_module, "get_db", lambda: real_test_db)

    # Pop before re-importing (not reload in place) so the whole dependency graph re-resolves consistently.
    for name in (
        "app",
        "status_api",
        "inference.predictor",
        "inference.predictor_manager",
        "db.training_run_repository",
        "db.feedback_repository",
        "training.retrain_pipeline",
        "training.dataset_builder",
    ):
        sys.modules.pop(name, None)

    import training.model_bundle as model_bundle
    importlib.reload(model_bundle)
    assert model_bundle.MODELS_DIR == models_root

    import db.training_run_repository as runs_repo
    import db.feedback_repository as feedback_repo

    # Fail immediately, naming the actual database, if these repositories are pointed at anything but the test DB.
    expected_db_name = os.environ["ML_TEST_MONGO_DB_NAME"]
    for label, collection in (
        ("training_run_repository._runs()", runs_repo._runs()),
        ("training_run_repository._locks()", runs_repo._locks()),
        ("feedback_repository._collection()", feedback_repo._collection()),
    ):
        actual_db_name = collection.database.name
        assert actual_db_name == expected_db_name, (
            f"{label} is connected to database {actual_db_name!r}, expected "
            f"the dedicated test database {expected_db_name!r} -- refusing "
            f"to run this test against the wrong database (e.g. auth-db)."
        )

    # Both must bind to the same feedback_repo/model_bundle objects just prepared above.
    import training.dataset_builder as dataset_builder_module
    import training.retrain_pipeline as retrain_pipeline_module

    assert dataset_builder_module.feedback is feedback_repo, (
        "training.dataset_builder's own 'feedback' binding does not match "
        "the freshly-imported db.feedback_repository -- the background "
        "retraining worker would reserve feedback against a different "
        "repository instance than this test inserted into."
    )
    assert retrain_pipeline_module.dataset_builder is dataset_builder_module, (
        "training.retrain_pipeline's own 'dataset_builder' binding does not "
        "match the freshly-imported training.dataset_builder module."
    )
    assert retrain_pipeline_module.model_bundle is model_bundle, (
        "training.retrain_pipeline's own 'model_bundle' binding does not "
        "match the freshly-imported training.model_bundle -- the actual "
        "training subprocess call would use the wrong MODELS_DIR."
    )

    # Confirms this fresh import resolved the real legacy artifacts, not a leaked mocked-fixture temp path.
    import inference.predictor_manager as predictor_manager_module
    for path in (
        predictor_manager_module.LEGACY_MODEL_PATH,
        predictor_manager_module.LEGACY_VECTORIZER_PATH,
        predictor_manager_module.LEGACY_ENCODER_PATH,
    ):
        assert "ml-unit-" not in path, (
            f"inference.predictor_manager leaked a mocked-fixture temp path: {path!r} -- "
            f"a prior test's monkeypatch/reload cleanup did not fully undo its mutations."
        )
        assert os.path.isfile(path), f"expected a real legacy artifact at {path!r}, but it does not exist"

    import inference.predictor as predictor_module  # noqa: F401
    import status_api as status_api_module  # noqa: F401
    import app as app_module

    # Proves app.py's module-level names, the sys.modules cache, and what /retrain-model actually runs all agree.
    assert app_module.feedback is feedback_repo
    assert app_module.runs is runs_repo
    assert app_module.model_bundle is model_bundle
    assert sys.modules["db.feedback_repository"] is feedback_repo
    assert sys.modules["db.training_run_repository"] is runs_repo

    background_globals = app_module.background_retrain.__globals__
    assert background_globals["feedback"] is app_module.feedback
    assert background_globals["runs"] is app_module.runs
    assert background_globals["model_bundle"] is app_module.model_bundle
    # The load-bearing check: run_retraining's own internals reserve feedback via training.dataset_builder.
    assert background_globals["run_retraining"] is retrain_pipeline_module.run_retraining
    assert dataset_builder_module.feedback is app_module.feedback

    with fastapi_testclient.TestClient(app_module.app) as c:
        yield c, app_module


def _insert_synthetic_pending_feedback(app_module, count=12):
    """
    Real Windows run finding: the previous version of this helper wrote an
    "expenseCategory" field, but training/dataset_builder.py's
    `_validate_feedback_doc` reads `doc.get("actualCategory")` (see
    training/dataset_builder.py:111) -- so every synthetic document was
    rejected as an unrecognized/missing category, and NONE of the inserted
    feedback ever entered the training dataset (the real run reported
    acceptedFeedback: 0, rejectedFeedback: 124). This is a test schema bug,
    not a production defect: dataset_builder.py's expectation of
    `actualCategory` matches the feedback documents the real backend
    actually writes (see backend/config/Schemas.js's MlFeedbackSchema).

    Fixed to use the production field name `actualCategory`, and to only
    ever use canonical categories from training/category_config.py's own
    CANONICAL_CATEGORIES list (never invented category strings) so
    normalize_category(...) accepts every row. Count reduced to a small,
    controlled 12 (within the 8-16 range) so the accepted/rejected
    assertions below are meaningful and easy to reason about.
    """
    from training.category_config import CANONICAL_CATEGORIES

    categories = [c for c in CANONICAL_CATEGORIES if c in ("Food", "Transport", "Groceries", "Bills")]
    docs = []
    rng = random.Random(7)
    for i in range(count):
        docs.append({
            "status": "pending",
            "expenseName": f"{rng.choice(['store', 'shop', 'service'])} {i}",
            "actualCategory": categories[i % len(categories)],
            "attempts": 0,
            "_testRunMarker": os.getenv("PHASE_G_TEST_MARKER", "phase-g"),
        })
    result = app_module.feedback._collection().insert_many(docs)
    return set(result.inserted_ids)


def test_full_lifecycle_reaches_activated_and_synchronized_status(client, caplog):
    c, app_module = client
    operations_headers = {"X-ML-Operations-Token": OPERATIONS_TOKEN}

    inserted_feedback_ids = _insert_synthetic_pending_feedback(app_module)

    # Prove, before triggering retraining, that the insert collection and the worker's collection are identical.
    feedback_collection = app_module.feedback._collection()
    assert feedback_collection.database.name == os.environ["ML_TEST_MONGO_DB_NAME"]
    pending_ids = {
        doc["_id"]
        for doc in feedback_collection.find({
            "_id": {"$in": list(inserted_feedback_ids)},
            "status": "pending",
        })
    }
    assert pending_ids == inserted_feedback_ids

    worker_feedback = app_module.background_retrain.__globals__["feedback"]
    worker_collection = worker_feedback._collection()
    assert worker_feedback is app_module.feedback
    assert worker_collection.database.name == feedback_collection.database.name
    assert worker_collection.name == feedback_collection.name

    worker_visible_ids = {
        doc["_id"]
        for doc in worker_collection.find({
            "_id": {"$in": list(inserted_feedback_ids)},
            "status": "pending",
        })
    }
    assert worker_visible_ids == inserted_feedback_ids, (
        f"the background worker's own feedback collection does not see all "
        f"{len(inserted_feedback_ids)} inserted documents as pending -- "
        f"visible: {worker_visible_ids!r}"
    )

    caplog.set_level("INFO", logger="ml-service.lifecycle")

    resp = c.post("/retrain-model")
    assert resp.status_code in (200, 202)
    run_id = resp.json()["runId"]

    # A non-200 detail response must fail immediately, not silently time out looking like an activation failure.
    deadline = time.time() + 60
    status = None
    while time.time() < deadline:
        detail = c.get(f"/training-runs/{run_id}", headers=operations_headers)
        assert detail.status_code == 200, (
            f"training-run detail failed: status={detail.status_code}, body={detail.text}"
        )
        status = detail.json()["status"]
        if status in ("activated", "failed", "failed_validation", "failed_activation"):
            break
        time.sleep(1)

    assert status == "activated", f"run did not reach 'activated' in time (last status: {status})"

    final_detail = c.get(f"/training-runs/{run_id}", headers=operations_headers)
    assert final_detail.status_code == 200
    row_counts = final_detail.json().get("rowCounts") or {}

    # Confirms the inserted feedback was actually accepted into the dataset, not just training on the base data.
    assert row_counts.get("currentReserved") == len(inserted_feedback_ids), (
        f"expected exactly {len(inserted_feedback_ids)} reserved feedback "
        f"documents, got rowCounts={row_counts!r}"
    )
    assert row_counts.get("acceptedFeedback", 0) > 0, f"no synthetic feedback was accepted: {row_counts!r}"
    assert row_counts.get("rejectedFeedback", 0) == 0, f"synthetic feedback was unexpectedly rejected: {row_counts!r}"
    base_count = row_counts.get("base", 0)
    assert row_counts.get("finalDataset", 0) > base_count, f"final dataset did not grow past the base dataset: {row_counts!r}"

    ml_status = c.get("/ml-status", headers=operations_headers)
    assert ml_status.status_code == 200
    assert ml_status.json()["synchronized"] is True

    ready = c.get("/health/ready")
    assert ready.status_code == 200

    pred = c.post("/predict-category", json={"expenseName": "grocery store 42"})
    assert pred.status_code == 200
    assert set(pred.json().keys()) == {"expenseName", "cleanedText", "predictedCategory", "confidence"}

    # Every inserted document must reach "trained", owned by this run, with reservation/error bookkeeping cleared.
    feedback_docs = list(
        app_module.feedback._collection().find({"_id": {"$in": list(inserted_feedback_ids)}})
    )
    assert len(feedback_docs) == len(inserted_feedback_ids)
    for doc in feedback_docs:
        assert doc["status"] == "trained", f"feedback {doc['_id']} did not finalize to 'trained': {doc!r}"
        assert doc["trainingRunId"] == run_id, f"feedback {doc['_id']} has the wrong trainingRunId: {doc!r}"
        assert doc.get("trainedAt") is not None, f"feedback {doc['_id']} has no trainedAt: {doc!r}"
        assert doc.get("reservedAt") is None, f"feedback {doc['_id']} still has a reservedAt: {doc!r}"
        assert doc.get("lastError") is None, f"feedback {doc['_id']} has a lastError: {doc!r}"

    # The lifecycle must have emitted a "feedback_finalized" event for this run.
    finalized_events = [
        r for r in caplog.records
        if getattr(r, "event", None) == "feedback_finalized" and getattr(r, "runId", None) == run_id
    ]
    assert finalized_events, "expected a 'feedback_finalized' log event for this run, but none was recorded"
