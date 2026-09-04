"""
[UNIT] ML-001-T05 -- training/metrics.py: macro-F1, per-class metrics,
confusion matrix, and calibration.
"""

import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "training")))

import metrics  # noqa: E402


class TestComputeClassificationMetrics:
    def test_perfect_predictions_give_accuracy_and_macro_f1_of_1(self):
        y_true = ["Food", "Transport", "Food", "Rent"]
        y_pred = ["Food", "Transport", "Food", "Rent"]
        result = metrics.compute_classification_metrics(y_true, y_pred)
        assert result["accuracy"] == 1.0
        assert result["macroF1"] == 1.0
        for label_metrics in result["perClass"].values():
            assert label_metrics["f1"] == 1.0

    def test_macro_f1_weighs_a_small_class_equally_to_a_big_one(self):
        # 9 "Food" predicted correctly, but the 1 "Rent" example is wrong.
        # Overall accuracy is high (90%) but macro-F1 must reflect the
        # single small class's total failure, not be swamped by the big one.
        y_true = ["Food"] * 9 + ["Rent"]
        y_pred = ["Food"] * 9 + ["Food"]  # Rent misclassified as Food
        result = metrics.compute_classification_metrics(y_true, y_pred, labels=["Food", "Rent"])
        assert result["accuracy"] == pytest.approx(0.9)
        assert result["macroF1"] < 0.9  # macro-F1 must be pulled down by Rent's 0 recall/f1
        assert result["perClass"]["Rent"]["recall"] == 0.0
        assert result["perClass"]["Food"]["recall"] == 1.0

    def test_a_label_with_zero_support_still_appears_with_zeroed_metrics(self):
        result = metrics.compute_classification_metrics(
            ["Food", "Food"], ["Food", "Food"], labels=["Food", "NeverSeen"]
        )
        assert result["perClass"]["NeverSeen"]["support"] == 0
        assert result["perClass"]["NeverSeen"]["f1"] == 0.0

    def test_raises_on_mismatched_lengths(self):
        with pytest.raises(ValueError):
            metrics.compute_classification_metrics(["a", "b"], ["a"])

    def test_raises_on_empty_input(self):
        with pytest.raises(ValueError):
            metrics.compute_classification_metrics([], [])


class TestComputeConfusionMatrix:
    def test_diagonal_only_for_perfect_predictions(self):
        y_true = ["Food", "Transport", "Food"]
        y_pred = ["Food", "Transport", "Food"]
        result = metrics.compute_confusion_matrix(y_true, y_pred, labels=["Food", "Transport"])
        assert result["labels"] == ["Food", "Transport"]
        assert result["matrix"] == [[2, 0], [0, 1]]

    def test_off_diagonal_counts_a_specific_misclassification(self):
        y_true = ["Food", "Food", "Transport"]
        y_pred = ["Transport", "Food", "Transport"]
        result = metrics.compute_confusion_matrix(y_true, y_pred, labels=["Food", "Transport"])
        # Food row: 1 predicted Food, 1 predicted Transport.
        assert result["matrix"][0] == [1, 1]
        assert result["matrix"][1] == [0, 1]


class TestComputeCalibration:
    def test_perfectly_calibrated_confident_correct_predictions_have_zero_ece(self):
        # Confidence 1.0 with 100% actual accuracy -- confidence exactly
        # matches accuracy, so ECE must be 0. (0.95 confidence with 100%
        # accuracy would NOT be perfectly calibrated -- that's a 0.05 gap.)
        y_true = ["Food"] * 10
        y_pred = ["Food"] * 10
        confidences = [1.0] * 10
        result = metrics.compute_calibration(y_true, y_pred, confidences, n_bins=10)
        assert result["expectedCalibrationError"] == pytest.approx(0.0, abs=1e-9)
        populated = [b for b in result["bins"] if b["count"] > 0]
        assert len(populated) == 1
        assert populated[0]["accuracy"] == 1.0
        assert populated[0]["avgConfidence"] == 1.0

    def test_overconfident_wrong_predictions_produce_a_high_ece(self):
        y_true = ["Food", "Transport"] * 5
        y_pred = ["Transport", "Food"] * 5  # every single prediction wrong
        confidences = [0.99] * 10  # but reported as near-certain
        result = metrics.compute_calibration(y_true, y_pred, confidences, n_bins=10)
        # accuracy in that bin is 0, confidence ~0.99 -> ECE should be close to 0.99
        assert result["expectedCalibrationError"] > 0.9

    def test_raises_on_confidence_outside_0_1(self):
        with pytest.raises(ValueError):
            metrics.compute_calibration(["a"], ["a"], [1.5])

    def test_raises_on_mismatched_lengths(self):
        with pytest.raises(ValueError):
            metrics.compute_calibration(["a", "b"], ["a"], [0.5, 0.5])

    def test_empty_bins_report_null_not_zero(self):
        # All confidences near 1.0 -- low bins should be explicitly empty
        # (None), not misleadingly reported as 0% accuracy.
        result = metrics.compute_calibration(["a"] * 5, ["a"] * 5, [0.99] * 5, n_bins=10)
        empty_bins = [b for b in result["bins"] if b["count"] == 0]
        assert len(empty_bins) > 0
        for b in empty_bins:
            assert b["avgConfidence"] is None
            assert b["accuracy"] is None


class TestComputeFullMetrics:
    def test_bundles_classification_confusion_and_calibration_together(self):
        y_true = ["Food", "Transport", "Food", "Transport"]
        y_pred = ["Food", "Transport", "Transport", "Transport"]
        confidences = [0.9, 0.8, 0.55, 0.7]
        result = metrics.compute_full_metrics(y_true, y_pred, confidences=confidences)
        assert "accuracy" in result
        assert "macroF1" in result
        assert "perClass" in result
        assert "confusion" in result
        assert "calibration" in result

    def test_omits_calibration_when_no_confidences_given(self):
        result = metrics.compute_full_metrics(["Food"], ["Food"])
        assert "calibration" not in result
        assert "confusion" in result
