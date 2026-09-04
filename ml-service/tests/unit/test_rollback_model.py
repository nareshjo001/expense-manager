"""
[UNIT] (mocked pymongo/bson/fastapi, real or fake sklearn-shaped pickle
objects depending on what's installed -- see tests/conftest.py)

Exercises REAL, unmodified training/rollback_model.py against the same
`mocked_lifecycle_env` / `write_candidate` fixtures tests/unit/
test_lifecycle_mocked.py already established, so bundles are written into
an isolated temp models directory (model_bundle.MODELS_DIR, monkeypatched
by the fixture) rather than the project's real training/models/.

rollback_model.py imports `training.model_bundle` at its own module scope
(`from training import model_bundle`); because mocked_lifecycle_env
reloads that module fresh per-test and monkeypatches its MODELS_DIR, this
file always reloads rollback_model too and monkeypatches its own
`model_bundle` attribute onto the SAME fixture-patched module instance
(ctx.model_bundle) -- the same pattern mocked_lifecycle_env itself already
uses for training.model_cleanup.
"""

import importlib

import pytest


@pytest.fixture
def rb(mocked_lifecycle_env, monkeypatch):
    """Returns the freshly (re)loaded training.rollback_model module,
    wired against this test's own isolated model_bundle instance."""
    ctx = mocked_lifecycle_env
    from training import rollback_model
    importlib.reload(rollback_model)
    monkeypatch.setattr(rollback_model, "model_bundle", ctx.model_bundle)
    return rollback_model


def test_rollback_to_older_bundle_succeeds_and_updates_manifest(mocked_lifecycle_env, write_candidate, rb):
    ctx = mocked_lifecycle_env

    write_candidate("model-run1", "run1", dataset_hash="hash-1")
    write_candidate("model-run2", "run2", dataset_hash="hash-2")

    # run2 is the currently-active model (generation 1).
    manifest = ctx.model_bundle.build_manifest(
        model_version="model-run2", run_id="run2",
        artifact_path=ctx.model_bundle.bundle_dir("model-run2"),
        dataset_hash="hash-2",
        previous_model_version=ctx.model_bundle.LEGACY_VERSION,
        generation=1,
    )
    ctx.model_bundle.write_manifest(manifest)

    result = rb.rollback_to("model-run1", reason="regression observed in prod")

    assert result["fromModelVersion"] == "model-run2"
    assert result["toModelVersion"] == "model-run1"
    assert result["generation"] == 2
    assert result["reason"] == "regression observed in prod"
    assert result["publishedAt"]

    active = ctx.model_bundle.read_manifest()
    assert active["modelVersion"] == "model-run1"
    assert active["previousModelVersion"] == "model-run2"
    assert active["generation"] == 2
    assert active["runId"] == "run1"
    assert active["datasetHash"] == "hash-1"


def test_rollback_to_already_active_version_is_refused(mocked_lifecycle_env, write_candidate, rb):
    ctx = mocked_lifecycle_env

    write_candidate("model-run1", "run1", dataset_hash="hash-1")
    manifest = ctx.model_bundle.build_manifest(
        model_version="model-run1", run_id="run1",
        artifact_path=ctx.model_bundle.bundle_dir("model-run1"),
        dataset_hash="hash-1",
        previous_model_version=ctx.model_bundle.LEGACY_VERSION,
        generation=1,
    )
    ctx.model_bundle.write_manifest(manifest)

    with pytest.raises(rb.RollbackError, match="already the active model"):
        rb.rollback_to("model-run1")

    # Nothing changed -- same generation, same publishedAt.
    unchanged = ctx.model_bundle.read_manifest()
    assert unchanged["generation"] == 1
    assert unchanged["publishedAt"] == manifest["publishedAt"]


def test_rollback_to_nonexistent_bundle_is_refused(mocked_lifecycle_env, write_candidate, rb):
    ctx = mocked_lifecycle_env

    write_candidate("model-run1", "run1", dataset_hash="hash-1")
    manifest = ctx.model_bundle.build_manifest(
        model_version="model-run1", run_id="run1",
        artifact_path=ctx.model_bundle.bundle_dir("model-run1"),
        dataset_hash="hash-1",
        previous_model_version=ctx.model_bundle.LEGACY_VERSION,
        generation=1,
    )
    ctx.model_bundle.write_manifest(manifest)

    with pytest.raises(rb.RollbackError, match="not complete"):
        rb.rollback_to("model-does-not-exist")

    unchanged = ctx.model_bundle.read_manifest()
    assert unchanged["modelVersion"] == "model-run1"
    assert unchanged["generation"] == 1


def test_rollback_to_incomplete_bundle_is_refused(mocked_lifecycle_env, write_candidate, rb):
    ctx = mocked_lifecycle_env
    import os

    # An incomplete bundle: directory exists, but missing artifact files
    # (e.g. an interrupted/partial write that somehow survived).
    bundle_dir = ctx.model_bundle.bundle_dir("model-broken")
    os.makedirs(bundle_dir, exist_ok=True)
    with open(os.path.join(bundle_dir, "metadata.json"), "w", encoding="utf-8") as fh:
        fh.write('{"runId": "brokenrun", "modelVersion": "model-broken"}')
    # model.pkl / vectorizer.pkl / labelEncoder.pkl deliberately absent.

    with pytest.raises(rb.RollbackError, match="not complete"):
        rb.rollback_to("model-broken")

    assert ctx.model_bundle.read_manifest() is None


def test_rollback_with_no_manifest_yet_produces_generation_one(mocked_lifecycle_env, write_candidate, rb):
    ctx = mocked_lifecycle_env

    write_candidate("model-run1", "run1", dataset_hash="hash-1")
    assert ctx.model_bundle.read_manifest() is None

    result = rb.rollback_to("model-run1")

    assert result["fromModelVersion"] is None
    assert result["toModelVersion"] == "model-run1"
    assert result["generation"] == 1

    active = ctx.model_bundle.read_manifest()
    assert active["modelVersion"] == "model-run1"
    assert active["generation"] == 1
    assert active["previousModelVersion"] == ctx.model_bundle.LEGACY_VERSION


def test_list_promotable_bundles_sorted_newest_first_and_skips_incomplete(mocked_lifecycle_env, write_candidate, rb):
    ctx = mocked_lifecycle_env
    import os
    import time

    write_candidate("model-run1", "run1", dataset_hash="hash-1")
    time.sleep(0.01)
    write_candidate("model-run2", "run2", dataset_hash="hash-2")

    # An incomplete bundle must never appear in the promotable list.
    broken_dir = ctx.model_bundle.bundle_dir("model-broken")
    os.makedirs(broken_dir, exist_ok=True)

    bundles = rb.list_promotable_bundles()
    versions = [b["modelVersion"] for b in bundles]

    assert "model-broken" not in versions
    assert versions == ["model-run2", "model-run1"]
    assert bundles[0]["datasetHash"] == "hash-2"
    assert bundles[0]["runId"] == "run2"


def test_rollback_refused_when_current_manifest_is_invalid(mocked_lifecycle_env, write_candidate, rb):
    ctx = mocked_lifecycle_env
    import os

    write_candidate("model-run1", "run1", dataset_hash="hash-1")

    # Corrupt the manifest file directly (not via write_manifest) to simulate
    # an on-disk active.json that exists but cannot be trusted.
    os.makedirs(ctx.model_bundle.MODELS_DIR, exist_ok=True)
    with open(ctx.model_bundle.manifest_path(), "w", encoding="utf-8") as fh:
        fh.write("{not valid json")

    with pytest.raises(rb.RollbackError, match="invalid"):
        rb.rollback_to("model-run1")
