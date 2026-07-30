"""
[FILESYSTEM / UNIT] Controlled failure injection (Phase G item 13).

Uses the same mocked-pymongo/fastapi + real-filesystem fixtures as
tests/unit/ (see ../conftest.py) -- these ARE real, executable tests today
(no scikit-learn/real-Mongo needed), exercising real production code
(app.py, predictor_manager.py, model_bundle.py, model_cleanup.py) with
specific steps monkeypatched to fail via targeted monkeypatching and
temporary directories, per the Phase G brief's own suggested technique.
Label: FILESYSTEM/UNIT, never REAL-MONGODB.
"""

import os


def test_mongo_unavailable_before_retraining_leaves_no_orphan_run(mocked_lifecycle_env):
    ctx = mocked_lifecycle_env

    def _exploding_create_run(*a, **k):
        raise RuntimeError("simulated MongoDB outage")

    ctx.runs.create_run = _exploding_create_run
    try:
        response = ctx.app_module.retrain_model(payload=None)
    except Exception as exc:
        # app.py raises HTTPException(503) via _service_unavailable(); the fake carries status_code directly.
        assert getattr(exc, "status_code", None) == 503
    else:
        raise AssertionError("expected a 503 HTTPException")


def test_mongo_unavailable_after_activation_keeps_model_live(mocked_lifecycle_env, write_candidate):
    ctx = mocked_lifecycle_env
    run_id = ctx.runs.create_run("manual")
    ctx.runs.try_claim_lock(run_id)
    fid = ctx.feedback._collection().insert_one({
        "status": "reserved", "trainingRunId": run_id, "expenseName": "x", "expenseCategory": "Food",
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

    def _exploding_finalize(run_id):
        raise RuntimeError("simulated MongoDB write failure during finalization")

    ctx.app_module.feedback.finalize_trained_for_run = _exploding_finalize
    ctx.app_module.background_retrain(run_id)

    run_doc = ctx.runs.get_run(run_id)
    assert run_doc["status"] == "activated"
    assert ctx.model_bundle.read_manifest()["modelVersion"] == version
    assert run_doc.get("bookkeepingWarning") is not None
    fid_doc = ctx.feedback._collection().find_one({"_id": fid.inserted_id})
    assert fid_doc["status"] == "reserved"  # NOT returned to pending


def test_disk_write_failure_leaves_no_complete_bundle_and_rolls_back_feedback(mocked_lifecycle_env):
    ctx = mocked_lifecycle_env
    run_id = ctx.runs.create_run("manual")
    ctx.runs.try_claim_lock(run_id)
    fid = ctx.feedback._collection().insert_one({
        "status": "reserved", "trainingRunId": run_id, "expenseName": "x", "expenseCategory": "Food",
    })
    version = "model-" + run_id

    def fake_run_retraining_disk_full(rid, **kwargs):
        # Simulates trainer.py failing to write the bundle -- no modelVersion/artifactPath ever produced.
        return {
            "success": False, "stage": "training", "error": "simulated disk full during bundle write",
            "reservedFeedbackIds": [str(fid.inserted_id)],
            "datasetMetadata": {"sha256": "h", "rowCounts": {"total": 1}},
        }

    ctx.app_module.run_retraining = fake_run_retraining_disk_full
    ctx.app_module.background_retrain(run_id)

    assert not ctx.model_bundle.is_bundle_complete(version)
    run_doc = ctx.runs.get_run(run_id)
    assert run_doc["status"] == "failed"
    fid_doc = ctx.feedback._collection().find_one({"_id": fid.inserted_id})
    assert fid_doc["status"] == "pending"


def test_manifest_write_failure_leaves_old_manifest_active(mocked_lifecycle_env, write_candidate):
    ctx = mocked_lifecycle_env
    # Establish an initial activated model.
    run0 = ctx.runs.create_run("manual")
    ctx.runs.try_claim_lock(run0)
    v0 = "model-" + run0
    write_candidate(v0, run0)
    manifest0 = ctx.model_bundle.build_manifest(
        model_version=v0, run_id=run0, artifact_path=ctx.model_bundle.bundle_dir(v0),
        dataset_hash="h0", previous_model_version=ctx.model_bundle.LEGACY_VERSION, generation=1,
    )
    ctx.model_bundle.write_manifest(manifest0)
    ctx.runs.release_lock(run0)

    run1 = ctx.runs.create_run("manual")
    ctx.runs.try_claim_lock(run1)
    fid = ctx.feedback._collection().insert_one({
        "status": "reserved", "trainingRunId": run1, "expenseName": "y", "expenseCategory": "Food",
    })
    v1 = "model-" + run1
    write_candidate(v1, run1)

    def fake_run_retraining(rid, **kwargs):
        return {
            "success": True, "reservedFeedbackIds": [str(fid.inserted_id)],
            "datasetMetadata": {"sha256": "h1", "rowCounts": {"total": 1}},
            "modelVersion": v1, "artifactPath": ctx.model_bundle.bundle_dir(v1),
            "metrics": {"accuracy": 0.9}, "encoderClasses": ["Food"], "validation": {"success": True, "gates": []},
        }

    ctx.app_module.run_retraining = fake_run_retraining

    real_write_manifest = ctx.model_bundle.write_manifest
    ctx.model_bundle.write_manifest = lambda m: (_ for _ in ()).throw(RuntimeError("simulated disk failure"))
    try:
        ctx.app_module.background_retrain(run1)
    finally:
        ctx.model_bundle.write_manifest = real_write_manifest

    assert ctx.model_bundle.read_manifest()["modelVersion"] == v0
    run1_doc = ctx.runs.get_run(run1)
    assert run1_doc["status"] == "failed_activation"


def test_post_publication_swap_failure_restores_previous_manifest(mocked_lifecycle_env, write_candidate):
    ctx = mocked_lifecycle_env
    run0 = ctx.runs.create_run("manual")
    ctx.runs.try_claim_lock(run0)
    v0 = "model-" + run0
    write_candidate(v0, run0)
    manifest0 = ctx.model_bundle.build_manifest(
        model_version=v0, run_id=run0, artifact_path=ctx.model_bundle.bundle_dir(v0),
        dataset_hash="h0", previous_model_version=ctx.model_bundle.LEGACY_VERSION, generation=1,
    )
    ctx.model_bundle.write_manifest(manifest0)
    # Load it into the running predictor so there's a real "previous snapshot" to restore.
    snap0 = ctx.predictor_manager.preload_candidate(v0, run0, 1)
    ctx.predictor_manager.swap_in(snap0)
    ctx.runs.release_lock(run0)

    run1 = ctx.runs.create_run("manual")
    ctx.runs.try_claim_lock(run1)
    fid = ctx.feedback._collection().insert_one({
        "status": "reserved", "trainingRunId": run1, "expenseName": "z", "expenseCategory": "Food",
    })
    v1 = "model-" + run1
    write_candidate(v1, run1)

    def fake_run_retraining(rid, **kwargs):
        return {
            "success": True, "reservedFeedbackIds": [str(fid.inserted_id)],
            "datasetMetadata": {"sha256": "h1", "rowCounts": {"total": 1}},
            "modelVersion": v1, "artifactPath": ctx.model_bundle.bundle_dir(v1),
            "metrics": {"accuracy": 0.9}, "encoderClasses": ["Food"], "validation": {"success": True, "gates": []},
        }

    ctx.app_module.run_retraining = fake_run_retraining
    ctx.predictor_manager.smoke_test = lambda: (False, "simulated post-swap smoke failure")
    ctx.app_module.background_retrain(run1)

    assert ctx.model_bundle.read_manifest()["modelVersion"] == v0
    assert ctx.predictor_manager.current_snapshot().modelVersion == v0
    fid_doc = ctx.feedback._collection().find_one({"_id": fid.inserted_id})
    assert fid_doc["status"] == "pending"


def test_worker_reload_failure_keeps_serving_old_model_and_records_diagnostics(mocked_lifecycle_env, write_candidate):
    ctx = mocked_lifecycle_env
    run0 = ctx.runs.create_run("manual")
    v0 = "model-" + run0
    write_candidate(v0, run0)
    manifest0 = ctx.model_bundle.build_manifest(
        model_version=v0, run_id=run0, artifact_path=ctx.model_bundle.bundle_dir(v0),
        dataset_hash="h0", previous_model_version=ctx.model_bundle.LEGACY_VERSION, generation=1,
    )
    ctx.model_bundle.write_manifest(manifest0)
    snap0 = ctx.predictor_manager.preload_candidate(v0, run0, 1)
    ctx.predictor_manager.swap_in(snap0)

    # Publish a BROKEN manifest (references a bundle that doesn't exist).
    broken_manifest = ctx.model_bundle.build_manifest(
        model_version="model-does-not-exist", run_id="run-broken", artifact_path="/nowhere",
        dataset_hash="h", previous_model_version=v0, generation=2,
    )
    ctx.model_bundle.write_manifest(broken_manifest)

    ctx.predictor_manager._last_manifest_check_at = 0.0  # force the throttle window to be considered elapsed
    result_snapshot = ctx.predictor_manager.get_snapshot()

    assert result_snapshot.modelVersion == v0  # old model keeps serving
    diagnostics = ctx.predictor_manager.diagnostics()
    assert diagnostics["reloadFailureCount"] >= 1
    assert diagnostics["lastReloadError"] is not None


def test_cleanup_failure_never_changes_activation_or_feedback_state(mocked_lifecycle_env, write_candidate):
    ctx = mocked_lifecycle_env
    run1 = ctx.runs.create_run("manual")
    ctx.runs.try_claim_lock(run1)
    fid = ctx.feedback._collection().insert_one({
        "status": "reserved", "trainingRunId": run1, "expenseName": "z", "expenseCategory": "Food",
    })
    v1 = "model-" + run1
    write_candidate(v1, run1)

    def fake_run_retraining(rid, **kwargs):
        return {
            "success": True, "reservedFeedbackIds": [str(fid.inserted_id)],
            "datasetMetadata": {"sha256": "h1", "rowCounts": {"total": 1}},
            "modelVersion": v1, "artifactPath": ctx.model_bundle.bundle_dir(v1),
            "metrics": {"accuracy": 0.9}, "encoderClasses": ["Food"], "validation": {"success": True, "gates": []},
        }

    ctx.app_module.run_retraining = fake_run_retraining

    def _exploding_run_cleanup(*a, **k):
        raise RuntimeError("simulated cleanup crash")

    ctx.model_cleanup.run_cleanup = _exploding_run_cleanup
    ctx.app_module.background_retrain(run1)

    run_doc = ctx.runs.get_run(run1)
    assert run_doc["status"] == "activated"
    fid_doc = ctx.feedback._collection().find_one({"_id": fid.inserted_id})
    assert fid_doc["status"] == "trained"
