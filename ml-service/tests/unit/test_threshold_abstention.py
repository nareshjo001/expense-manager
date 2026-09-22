"""
[UNIT] ML-003-T03 -- inference/predictor.py's resolve_abstention() and
_load_threshold_policy(): the abstain/reason decision T03 adds to the
predict-category API contract, and its fallback behavior when
threshold_policy.json (ML-003-T02) is missing or malformed.

Real, unmocked tests -- resolve_abstention/_load_threshold_policy only
touch a JSON file on disk, no sklearn/joblib/pymongo involved, so these
run in any environment without tests/conftest.py's fake-dependency setup.
"""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from inference import predictor  # noqa: E402


class TestResolveAbstention:
    def test_confidence_below_global_threshold_abstains(self):
        policy = {"globalDefaultThreshold": 0.90, "perClassThresholds": {}}
        abstained, reason = predictor.resolve_abstention("Food", 85.0, policy)
        assert abstained is True
        assert reason == predictor.ABSTAIN_REASON_LOW_CONFIDENCE

    def test_confidence_above_global_threshold_does_not_abstain(self):
        policy = {"globalDefaultThreshold": 0.90, "perClassThresholds": {}}
        abstained, reason = predictor.resolve_abstention("Food", 95.0, policy)
        assert abstained is False
        assert reason is None

    def test_confidence_exactly_at_threshold_does_not_abstain(self):
        # >= threshold commits, per resolve_abstention's own docstring --
        # confidence_percent/100 < threshold is the ONLY abstain condition.
        policy = {"globalDefaultThreshold": 0.90, "perClassThresholds": {}}
        abstained, reason = predictor.resolve_abstention("Food", 90.0, policy)
        assert abstained is False
        assert reason is None

    def test_per_class_override_wins_over_global_when_present(self):
        # A category with a real (non-null) per-class threshold set --
        # forward-compatible with T02's documented revisitTrigger, even
        # though none are populated as of T02 itself.
        policy = {
            "globalDefaultThreshold": 0.90,
            "perClassThresholds": {"Personal Care": 0.99},
        }
        abstained, reason = predictor.resolve_abstention("Personal Care", 95.0, policy)
        assert abstained is True
        assert reason == predictor.ABSTAIN_REASON_LOW_CONFIDENCE

    def test_per_class_null_falls_back_to_global(self):
        policy = {
            "globalDefaultThreshold": 0.90,
            "perClassThresholds": {"Food": None},
        }
        abstained, reason = predictor.resolve_abstention("Food", 95.0, policy)
        assert abstained is False
        assert reason is None

    def test_category_absent_from_policy_falls_back_to_global(self):
        policy = {"globalDefaultThreshold": 0.90, "perClassThresholds": {"Food": 0.5}}
        abstained, reason = predictor.resolve_abstention("Unmapped Category", 85.0, policy)
        assert abstained is True

    def test_missing_perClassThresholds_key_does_not_raise(self):
        policy = {"globalDefaultThreshold": 0.90}
        abstained, reason = predictor.resolve_abstention("Food", 50.0, policy)
        assert abstained is True

    def test_missing_globalDefaultThreshold_falls_back_to_module_constant(self):
        policy = {"perClassThresholds": {}}
        abstained, _ = predictor.resolve_abstention(
            "Food", predictor.FALLBACK_GLOBAL_THRESHOLD * 100 - 1, policy
        )
        assert abstained is True


class TestLoadThresholdPolicy:
    def test_loads_the_real_policy_file_when_present(self):
        # Exercises the actual ml-service/training/threshold_policy.json
        # this repo ships (ML-003-T02), not a fixture -- if that file is
        # ever deleted or its schema changes incompatibly, this is the
        # test that should fail first.
        assert os.path.isfile(predictor.THRESHOLD_POLICY_PATH), (
            "threshold_policy.json is expected to exist once ML-003-T02 has "
            "run at least once; if this fails, re-run "
            "training/threshold_policy.py"
        )
        policy = predictor._load_threshold_policy()
        assert "globalDefaultThreshold" in policy
        assert isinstance(policy["globalDefaultThreshold"], float)

    def test_missing_file_falls_back_gracefully(self, monkeypatch):
        monkeypatch.setattr(
            predictor, "THRESHOLD_POLICY_PATH", "/nonexistent/threshold_policy.json"
        )
        policy = predictor._load_threshold_policy()
        assert policy == {
            "globalDefaultThreshold": predictor.FALLBACK_GLOBAL_THRESHOLD,
            "perClassThresholds": {},
        }

    def test_malformed_json_falls_back_gracefully(self, monkeypatch, tmp_path):
        bad_file = tmp_path / "threshold_policy.json"
        bad_file.write_text("{not valid json")
        monkeypatch.setattr(predictor, "THRESHOLD_POLICY_PATH", str(bad_file))
        policy = predictor._load_threshold_policy()
        assert policy["globalDefaultThreshold"] == predictor.FALLBACK_GLOBAL_THRESHOLD

    def test_valid_json_missing_required_key_falls_back_gracefully(self, monkeypatch, tmp_path):
        incomplete_file = tmp_path / "threshold_policy.json"
        incomplete_file.write_text(json.dumps({"perClassThresholds": {}}))
        monkeypatch.setattr(predictor, "THRESHOLD_POLICY_PATH", str(incomplete_file))
        policy = predictor._load_threshold_policy()
        assert policy["globalDefaultThreshold"] == predictor.FALLBACK_GLOBAL_THRESHOLD

    def test_never_caches_stale_content_between_calls(self, monkeypatch, tmp_path):
        # Deliberate design choice (see _load_threshold_policy's own
        # docstring): a freshly regenerated policy file must take effect
        # on the very next call, with no in-process cache to invalidate.
        policy_file = tmp_path / "threshold_policy.json"
        policy_file.write_text(json.dumps({"globalDefaultThreshold": 0.5, "perClassThresholds": {}}))
        monkeypatch.setattr(predictor, "THRESHOLD_POLICY_PATH", str(policy_file))

        first = predictor._load_threshold_policy()
        assert first["globalDefaultThreshold"] == 0.5

        policy_file.write_text(json.dumps({"globalDefaultThreshold": 0.75, "perClassThresholds": {}}))
        second = predictor._load_threshold_policy()
        assert second["globalDefaultThreshold"] == 0.75
