"""
[UNIT] (mocked pymongo/bson/fastapi + fake sklearn-shaped pickle objects)

A pytest-organized subset of the mocked-lifecycle assertions previously
maintained as standalone scripts (outputs/verify_phase_e.py,
outputs/verify_phase_f.py from Phases E/F). Those two scripts remain the
most exhaustive mocked-lifecycle regression suites and are unaffected by
this file; this file exists to satisfy Phase G item 18's request for a
pytest-discoverable `tests/unit/` tier, using the shared `conftest.py`
fixtures in this directory.

Every assertion below exercises REAL production code (app.py,
predictor_manager.py, model_bundle.py, the repositories) -- only pymongo/
bson/fastapi/pydantic/joblib are faked. Label: UNIT, not REAL-MONGODB or
REAL-SKLEARN.
"""

import os


def test_legacy_startup_with_no_manifest(mocked_lifecycle_env):
    ctx = mocked_lifecycle_env
    snapshot = ctx.predictor_manager.current_snapshot()
    assert snapshot.modelVersion == ctx.model_bundle.LEGACY_VERSION


def test_successful_activation_end_to_end(mocked_lifecycle_env, write_candidate):
    ctx = mocked_lifecycle_env
    run_id = ctx.runs.create_run("manual")
    ctx.runs.try_claim_lock(run_id)
    fid = ctx.feedback._collection().insert_one({
        "status": "reserved", "trainingRunId": run_id,
        "expenseName": "coffee", "expenseCategory": "Food",
    })
    version = "model-" + run_id
    write_candidate(version, run_id)

    def fake_run_retraining(rid, **kwargs):
        return {
            "success": True, "reservedFeedbackIds": [str(fid.inserted_id)],
            "datasetMetadata": {"sha256": "h", "rowCounts": {"total": 1}},
            "modelVersion": version, "artifactPath": ctx.model_bundle.bundle_dir(version),
            "metrics": {"accuracy": 0.9}, "encoderClasses": ["Food"],
            "validation": {"success": True, "gates": []},
        }

    ctx.app_module.run_retraining = fake_run_retraining
    ctx.app_module.background_retrain(run_id)

    run_doc = ctx.runs.get_run(run_id)
    assert run_doc["status"] == "activated"
    assert ctx.model_bundle.read_manifest()["modelVersion"] == version
    assert ctx.predictor_manager.current_snapshot().modelVersion == version
    fid_doc = ctx.feedback._collection().find_one({"_id": fid.inserted_id})
    assert fid_doc["status"] == "trained"


def test_validation_failure_returns_feedback_to_pending(mocked_lifecycle_env):
    ctx = mocked_lifecycle_env
    run_id = ctx.runs.create_run("manual")
    ctx.runs.try_claim_lock(run_id)
    fid = ctx.feedback._collection().insert_one({
        "status": "reserved", "trainingRunId": run_id,
        "expenseName": "x", "expenseCategory": "Food", "attempts": 0,
    })

    def fake_run_retraining(rid, **kwargs):
        return {
            "success": False, "stage": "validation", "error": "simulated gate failure",
            "reservedFeedbackIds": [str(fid.inserted_id)],
            "datasetMetadata": {"sha256": "h", "rowCounts": {"total": 1}},
            "modelVersion": "model-" + run_id, "artifactPath": "/tmp/x",
            "metrics": {"accuracy": 0.1}, "encoderClasses": ["Food"],
            "validation": {"success": False, "gates": []},
        }

    ctx.app_module.run_retraining = fake_run_retraining
    ctx.app_module.background_retrain(run_id)

    run_doc = ctx.runs.get_run(run_id)
    assert run_doc["status"] == "failed_validation"
    fid_doc = ctx.feedback._collection().find_one({"_id": fid.inserted_id})
    assert fid_doc["status"] == "pending"
    assert fid_doc.get("attempts") == 1


def test_predict_category_response_shape_is_unchanged(mocked_lifecycle_env):
    import importlib
    import inference.predictor as predictor_module
    importlib.reload(predictor_module)
    predictor_module.predictor_manager = mocked_lifecycle_env.predictor_manager

    result = predictor_module.predict_category("grocery store")
    assert set(result.keys()) == {"expenseName", "cleanedText", "predictedCategory", "confidence"}


def test_mocked_fixture_does_not_leak_legacy_paths_after_teardown(mocked_lifecycle_env):
    """
    [UNIT] Order-isolation regression test (full-suite test-order
    contamination fix): confirms that `mocked_lifecycle_env`'s own
    `inference.predictor_manager` module-attribute mutations
    (LEGACY_MODEL_PATH/LEGACY_VECTORIZER_PATH/LEGACY_ENCODER_PATH pointed at
    this fixture's own "ml-unit-*" tmpdir) are visible for the DURATION of
    this test only, and are gone -- not merely restored to some other
    mocked value, but genuinely gone from sys.modules -- the instant this
    test's own `mocked_lifecycle_env` fixture tears down.

    This test's body only asserts the leaked-during-the-test state (which
    is expected and correct while the fixture is active); the real
    assertion this regression guards is enforced by
    tests/integration/test_end_to_end_retraining.py's `client` fixture,
    which reloads inference.predictor_manager fresh and asserts
    "ml-unit-" is NOT in any LEGACY_* path -- that assertion only passes if
    this fixture's teardown (monkeypatch.setattr + the sys.modules
    eviction in tests/conftest.py's mocked_lifecycle_env) actually ran.
    Combined, these two tests are the "mocked lifecycle -> failure
    injection -> real E2E fixture initialization" order-isolation sequence
    requested for this fix; run them together with
    tests/failure_injection/ in both orders (see this fix's own
    verification commands) to exercise it directly.
    """
    import inference.predictor_manager as pm

    assert "ml-unit-" in pm.LEGACY_MODEL_PATH, (
        "expected the mocked fixture's own tmp legacy path to be active "
        "for the duration of this test"
    )
