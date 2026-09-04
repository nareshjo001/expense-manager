"""
[UNIT] (mocked pymongo/bson/fastapi + fake sklearn-shaped pickle objects)

ML-001-T06 -- manual promotion gate. Exercises REAL, unmodified production
code (app.py's background_retrain/approve_training_run/reject_training_run,
config.is_manual_approval_required, db.training_run_repository's
mark_awaiting_approval/mark_rejected) against the same mocked_lifecycle_env
/ write_candidate fixtures tests/unit/test_lifecycle_mocked.py already
established. Only pymongo/bson/fastapi/pydantic/joblib are faked.

Regression coverage for the flag OFF (default) case lives in
tests/unit/test_lifecycle_mocked.py itself, run UNMODIFIED -- see this
task's own verification notes. This file covers only the flag-ON paths
and the two new endpoints.
"""

import pytest

CORRECT_TOKEN = "manual-approval-test-token"


def _fake_run_retraining(version, dataset_hash="hash-1"):
    def _fn(rid, **kwargs):
        return {
            "success": True, "reservedFeedbackIds": [],
            "datasetMetadata": {"sha256": dataset_hash, "rowCounts": {"total": 1}},
            "modelVersion": version, "artifactPath": None,
            "metrics": {"accuracy": 0.9}, "encoderClasses": ["Food"],
            "validation": {"success": True, "gates": []},
        }
    return _fn


def _start_run_with_candidate(ctx, write_candidate, version_suffix="1", dataset_hash="hash-1"):
    run_id = ctx.runs.create_run("manual")
    ctx.runs.try_claim_lock(run_id)
    version = f"model-{run_id}"
    write_candidate(version, run_id, dataset_hash=dataset_hash)
    return run_id, version


def test_flag_on_stops_at_awaiting_approval_without_activating(mocked_lifecycle_env, write_candidate, monkeypatch):
    """
    With ML_REQUIRE_MANUAL_APPROVAL enabled, a validation success must
    stop at "awaiting_approval" -- _attempt_activation must never be
    called (no manifest written, no runtime swap) and the run's status
    must not become "activated".
    """
    ctx = mocked_lifecycle_env
    monkeypatch.setenv("ML_REQUIRE_MANUAL_APPROVAL", "true")

    run_id, version = _start_run_with_candidate(ctx, write_candidate)

    activation_calls = []
    original = ctx.app_module._attempt_activation

    def spy(*args, **kwargs):
        activation_calls.append((args, kwargs))
        return original(*args, **kwargs)

    monkeypatch.setattr(ctx.app_module, "_attempt_activation", spy)
    ctx.app_module.run_retraining = _fake_run_retraining(version)

    ctx.app_module.background_retrain(run_id)

    run_doc = ctx.runs.get_run(run_id)
    assert run_doc["status"] == "awaiting_approval"
    assert activation_calls == []
    assert ctx.model_bundle.read_manifest() is None
    assert ctx.predictor_manager.current_snapshot().modelVersion == ctx.model_bundle.LEGACY_VERSION
    # The candidate's own identity is already recorded on the run document,
    # ready for /approve to use without any new persistence.
    assert run_doc["modelVersion"] == version
    assert run_doc["datasetHash"] == "hash-1"


def test_flag_off_still_activates_automatically(mocked_lifecycle_env, write_candidate, monkeypatch):
    """Sanity check alongside the flag-ON test above: with the flag
    explicitly OFF, the automatic path still runs (belt-and-suspenders on
    top of the full unmodified test_lifecycle_mocked.py suite)."""
    ctx = mocked_lifecycle_env
    monkeypatch.setenv("ML_REQUIRE_MANUAL_APPROVAL", "false")

    run_id, version = _start_run_with_candidate(ctx, write_candidate)
    ctx.app_module.run_retraining = _fake_run_retraining(version)

    ctx.app_module.background_retrain(run_id)

    run_doc = ctx.runs.get_run(run_id)
    assert run_doc["status"] == "activated"
    assert ctx.model_bundle.read_manifest()["modelVersion"] == version


def test_approve_activates_awaiting_approval_run(mocked_lifecycle_env, write_candidate, monkeypatch):
    ctx = mocked_lifecycle_env
    app_module = ctx.app_module
    app_module.os.environ["ML_OPERATIONS_TOKEN"] = CORRECT_TOKEN
    monkeypatch.setenv("ML_REQUIRE_MANUAL_APPROVAL", "true")

    run_id, version = _start_run_with_candidate(ctx, write_candidate)
    app_module.run_retraining = _fake_run_retraining(version)
    app_module.background_retrain(run_id)
    assert ctx.runs.get_run(run_id)["status"] == "awaiting_approval"

    result = app_module.approve_training_run(run_id, x_ml_operations_token=CORRECT_TOKEN)

    assert getattr(result, "status_code", None) == 200
    run_doc = ctx.runs.get_run(run_id)
    assert run_doc["status"] == "activated"
    assert ctx.model_bundle.read_manifest()["modelVersion"] == version
    assert ctx.predictor_manager.current_snapshot().modelVersion == version


def test_approve_on_wrong_status_is_rejected_and_manifest_untouched(mocked_lifecycle_env, write_candidate, monkeypatch):
    ctx = mocked_lifecycle_env
    app_module = ctx.app_module
    app_module.os.environ["ML_OPERATIONS_TOKEN"] = CORRECT_TOKEN

    # A run that is only "running" (never reached awaiting_approval) is not approvable.
    run_id = ctx.runs.create_run("manual")
    ctx.runs.try_claim_lock(run_id)
    ctx.runs.mark_running(run_id)

    HTTPException = app_module.HTTPException
    with pytest.raises(HTTPException) as exc_info:
        app_module.approve_training_run(run_id, x_ml_operations_token=CORRECT_TOKEN)

    assert exc_info.value.status_code == 409
    assert ctx.model_bundle.read_manifest() is None
    assert ctx.runs.get_run(run_id)["status"] == "running"


def test_approve_on_missing_run_returns_404(mocked_lifecycle_env, monkeypatch):
    ctx = mocked_lifecycle_env
    app_module = ctx.app_module
    app_module.os.environ["ML_OPERATIONS_TOKEN"] = CORRECT_TOKEN

    HTTPException = app_module.HTTPException
    with pytest.raises(HTTPException) as exc_info:
        app_module.approve_training_run("000000000000000000000000", x_ml_operations_token=CORRECT_TOKEN)
    assert exc_info.value.status_code == 404


def test_reject_sets_rejected_status_and_leaves_manifest_and_bundle_untouched(mocked_lifecycle_env, write_candidate, monkeypatch):
    ctx = mocked_lifecycle_env
    app_module = ctx.app_module
    app_module.os.environ["ML_OPERATIONS_TOKEN"] = CORRECT_TOKEN
    monkeypatch.setenv("ML_REQUIRE_MANUAL_APPROVAL", "true")

    run_id, version = _start_run_with_candidate(ctx, write_candidate)
    app_module.run_retraining = _fake_run_retraining(version)
    app_module.background_retrain(run_id)
    assert ctx.runs.get_run(run_id)["status"] == "awaiting_approval"

    payload = app_module.ApprovalDecisionRequest()
    payload.reason = "not a real improvement over baseline"

    result = app_module.reject_training_run(run_id, payload=payload, x_ml_operations_token=CORRECT_TOKEN)

    assert getattr(result, "status_code", None) == 200
    run_doc = ctx.runs.get_run(run_id)
    assert run_doc["status"] == "rejected"
    assert run_doc["rejectionReason"] == "not a real improvement over baseline"

    # Manifest was never written -- rejection is a pure status change.
    assert ctx.model_bundle.read_manifest() is None
    # The candidate bundle itself is left completely untouched on disk.
    assert ctx.model_bundle.is_bundle_complete(version)


def test_reject_on_wrong_status_is_rejected(mocked_lifecycle_env, write_candidate, monkeypatch):
    ctx = mocked_lifecycle_env
    app_module = ctx.app_module
    app_module.os.environ["ML_OPERATIONS_TOKEN"] = CORRECT_TOKEN

    run_id = ctx.runs.create_run("manual")
    ctx.runs.try_claim_lock(run_id)
    ctx.runs.mark_running(run_id)

    HTTPException = app_module.HTTPException
    with pytest.raises(HTTPException) as exc_info:
        app_module.reject_training_run(run_id, payload=None, x_ml_operations_token=CORRECT_TOKEN)

    assert exc_info.value.status_code == 409
    assert ctx.runs.get_run(run_id)["status"] == "running"
