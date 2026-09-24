"""
[UNIT] ML-003-T07 -- training/threshold_policy.py's build_policy(): input
validation and edge-case handling for calibration_report.json, the artifact
T02 already ships one (real) copy of and T03's resolve_abstention()/
_load_threshold_policy() (see test_threshold_abstention.py) consume the
OUTPUT of. That existing test file covers the consumer side (a threshold
policy JSON that already exists, possibly missing/malformed on disk); this
file covers the producer side (build_policy()'s own tolerance of a
malformed calibration_report.json input) -- a genuinely untested path
before this task (confirmed: no test file referenced threshold_policy or
build_policy anywhere in this repo prior to this change).

Real, unmocked tests -- build_policy() is a pure, offline transform with no
sklearn/joblib/pymongo/network dependency (see the module's own docstring:
"does not require a database connection"), so these run in any environment.
"""

import copy
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "training")))

import threshold_policy  # noqa: E402


def _valid_report(**overrides):
    """
    A minimal but schema-shaped calibration_report.json fixture, matching
    what calibrate_confidence.py (ML-003-T01) actually produces: `task`,
    `perClass` keyed by category with `predictedCount` and a `curve` list
    of {threshold, coverage, precision} points. Two classes is enough to
    exercise both a normal and a below-average-coverage flag.
    """
    report = {
        "task": "ML-003-T01",
        "methodologyCaveat": "validation fold drawn from templated/synthetic data",
        "precisionTargets": [0.80, 0.90, 0.95],
        "perClass": {
            "Food": {
                "predictedCount": 100,
                "curve": [
                    {"threshold": 0.80, "coverage": 98, "precision": 0.99},
                    {"threshold": 0.85, "coverage": 96, "precision": 0.99},
                    {"threshold": 0.90, "coverage": 90, "precision": 1.0},
                    {"threshold": 0.95, "coverage": 80, "precision": 1.0},
                ],
            },
            "Travel": {
                "predictedCount": 50,
                "curve": [
                    {"threshold": 0.80, "coverage": 40, "precision": 0.95},
                    {"threshold": 0.85, "coverage": 35, "precision": 0.96},
                    {"threshold": 0.90, "coverage": 30, "precision": 0.97},
                    {"threshold": 0.95, "coverage": 20, "precision": 0.98},
                ],
            },
        },
    }
    report.update(overrides)
    return report


class TestBuildPolicyValidInput:
    def test_valid_report_builds_a_well_formed_policy(self):
        policy = threshold_policy.build_policy(_valid_report())

        assert policy["schemaVersion"] == threshold_policy.SCHEMA_VERSION
        assert policy["task"] == "ML-003-T02"
        assert policy["globalDefaultThreshold"] == threshold_policy.GLOBAL_DEFAULT_THRESHOLD
        assert set(policy["perClassThresholds"].keys()) == set(
            __import__("category_config").CANONICAL_CATEGORIES
        )
        assert all(v is None for v in policy["perClassThresholds"].values())
        assert len(policy["coverageAtCandidateThresholds"]) == 4

    def test_a_custom_global_threshold_is_used_verbatim(self):
        policy = threshold_policy.build_policy(_valid_report(), global_threshold=0.75)
        assert policy["globalDefaultThreshold"] == 0.75

    def test_methodology_caveat_is_carried_forward_when_present(self):
        policy = threshold_policy.build_policy(_valid_report())
        assert (
            policy["basedOn"]["methodologyCaveatCarriedForward"]
            == "validation fold drawn from templated/synthetic data"
        )

    def test_missing_methodology_caveat_defaults_to_none_not_a_crash(self):
        report = _valid_report()
        del report["methodologyCaveat"]
        policy = threshold_policy.build_policy(report)
        assert policy["basedOn"]["methodologyCaveatCarriedForward"] is None

    def test_missing_precisionTargets_falls_back_to_the_default_triple(self):
        report = _valid_report()
        del report["precisionTargets"]
        policy = threshold_policy.build_policy(report)
        assert policy["qualityTargets"] == [0.80, 0.90, 0.95]


class TestBuildPolicyTaskGuard:
    def test_wrong_task_marker_raises_a_clear_value_error(self):
        report = _valid_report(task="ML-999-SOMETHING-ELSE")
        with pytest.raises(ValueError, match="ML-999-SOMETHING-ELSE"):
            threshold_policy.build_policy(report)

    def test_missing_task_key_entirely_also_raises_value_error(self):
        report = _valid_report()
        del report["task"]
        with pytest.raises(ValueError):
            threshold_policy.build_policy(report)


class TestBuildPolicyMalformedPerClass:
    """
    build_policy()/`_coverage_at_threshold` do not currently validate the
    shape of `perClass` beyond what iterating and indexing naturally
    requires -- these tests lock in what actually happens today (some
    malformed shapes raise a raw KeyError, others are tolerated), so a
    future change to this tolerance is a deliberate, visible decision
    rather than an unnoticed regression either way.
    """

    def test_missing_perClass_key_raises_key_error(self):
        report = _valid_report()
        del report["perClass"]
        with pytest.raises(KeyError):
            threshold_policy.build_policy(report)

    def test_class_entry_missing_curve_but_with_predictions_raises_key_error(self):
        report = _valid_report()
        del report["perClass"]["Travel"]["curve"]
        with pytest.raises(KeyError):
            threshold_policy.build_policy(report)

    def test_class_entry_with_zero_predicted_count_is_skipped_even_if_curve_is_malformed(self):
        # predicted_count == 0 short-circuits before `curve` is ever
        # touched (`if predicted_count == 0: continue`), so a class with
        # no predictions at all is tolerated regardless of its curve's
        # shape -- this is NOT the same code path as the missing-curve
        # case above, and this test exists so that distinction stays
        # intentional rather than incidental.
        report = _valid_report()
        report["perClass"]["Travel"] = {"predictedCount": 0}
        policy = threshold_policy.build_policy(report)
        # Only Food (100 predictions) should contribute.
        point_90 = next(p for p in policy["coverageAtCandidateThresholds"] if p["threshold"] == 0.90)
        assert point_90["totalPredicted"] == 100

    def test_class_entry_with_empty_curve_list_is_skipped_gracefully_not_a_crash(self):
        report = _valid_report()
        report["perClass"]["Travel"]["curve"] = []
        policy = threshold_policy.build_policy(report)
        point_90 = next(p for p in policy["coverageAtCandidateThresholds"] if p["threshold"] == 0.90)
        # Travel's 50 predictions still count toward totalPredicted (that
        # increment happens before the curve lookup), but contribute zero
        # to totalCommitted since no matching threshold point exists.
        assert point_90["totalPredicted"] == 150
        assert point_90["totalCommitted"] == 90  # Food's committed count only

    def test_all_classes_zero_predicted_count_avoids_a_division_by_zero_crash(self):
        report = _valid_report()
        for cls in report["perClass"]:
            report["perClass"][cls]["predictedCount"] = 0
        policy = threshold_policy.build_policy(report)
        for point in policy["coverageAtCandidateThresholds"]:
            assert point["totalPredicted"] == 0
            assert point["overallCoverageFraction"] is None
            assert point["overallPrecisionAmongCommitted"] is None

    def test_empty_perClass_dict_produces_an_empty_but_valid_policy(self):
        report = _valid_report()
        report["perClass"] = {}
        policy = threshold_policy.build_policy(report)
        assert len(policy["coverageAtCandidateThresholds"]) == 4
        for point in policy["coverageAtCandidateThresholds"]:
            assert point["totalPredicted"] == 0


class TestBuildPolicyKnownGaps:
    """
    Documents current gaps deliberately, the same way this feature's other
    tasks have documented scoping decisions rather than silently leaving
    them unnoted (see e.g. ML-003-T02's own docstring). These are NOT
    assertions that the current behavior is correct -- they are a record
    of it, so a future task closing the gap changes an explicit, named
    test rather than discovering the gap from scratch.
    """

    def test_KNOWN_GAP_an_out_of_range_global_threshold_is_accepted_without_validation(self):
        # global_threshold is never range-checked against [0, 1] -- a
        # caller (today, only threshold_policy.py's own CLI via
        # --global-threshold) could write an unusable value straight into
        # threshold_policy.json with no error at generation time. T03's
        # resolve_abstention() would still "work" against it (comparing
        # confidence/100 < threshold), just nonsensically (e.g. never
        # abstaining at threshold 1.5, or always abstaining at -0.5).
        policy_high = threshold_policy.build_policy(_valid_report(), global_threshold=1.5)
        policy_low = threshold_policy.build_policy(_valid_report(), global_threshold=-0.5)
        assert policy_high["globalDefaultThreshold"] == 1.5
        assert policy_low["globalDefaultThreshold"] == -0.5

    def test_KNOWN_GAP_a_curve_point_with_a_non_numeric_precision_type_is_not_type_checked(self):
        # precision is only ever null-checked (`point["precision"] is
        # None`), never type/range-checked -- a string or an
        # out-of-[0,1]-range number in curve data is not caught by any
        # explicit validation. It still fails, but only incidentally: the
        # `coverage * precision` multiplication a few lines later raises a
        # bare TypeError with no message pointing a future reader at
        # "precision must be numeric" -- that's the gap being documented
        # here, not that build_policy() silently accepts the bad value.
        report = _valid_report()
        report["perClass"]["Food"]["curve"][2]["precision"] = "not-a-number"
        with pytest.raises(TypeError):
            threshold_policy.build_policy(report)


class TestBuildPolicyDoesNotMutateItsInput:
    def test_the_calibration_report_argument_is_not_mutated(self):
        report = _valid_report()
        snapshot = copy.deepcopy(report)
        threshold_policy.build_policy(report)
        assert report == snapshot
