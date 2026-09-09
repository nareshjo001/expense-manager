
"""
[UNIT] ML-001-T05 -- training/metrics.py: macro-F1, per-class metrics,
confusion matrix, top-k recall, and calibration.
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



class TestComputeTopKRecall:
    # Three classes, columns ordered ["Food", "Rent", "Transport"].
    LABELS = ["Food", "Rent", "Transport"]

    def test_top1_matches_plain_accuracy_and_top_k_is_monotonic(self):
        y_true = ["Food", "Rent", "Transport"]
        proba = [
            [0.7, 0.2, 0.1],  # Food ranked 1st -> hit at k=1
            [0.5, 0.3, 0.2],  # Rent ranked 2nd -> miss at k=1, hit at k=2
            [0.6, 0.3, 0.1],  # Transport ranked 3rd -> hit only at k=3
        ]
        result = metrics.compute_topk_recall(y_true, proba, self.LABELS, ks=(1, 2, 3))
        assert result["overall"]["top1"] == pytest.approx(1 / 3)
        assert result["overall"]["top2"] == pytest.approx(2 / 3)
        assert result["overall"]["top3"] == pytest.approx(1.0)

    def test_top1_equals_argmax_accuracy(self):
        # The invariant that makes this metric trustworthy: top-1 recall
        # must agree with the accuracy computed from argmax predictions.
        y_true = ["Food", "Rent", "Transport", "Food"]
        proba = [
            [0.7, 0.2, 0.1],
            [0.1, 0.8, 0.1],
            [0.4, 0.4, 0.2],  # tie broken toward the earlier column -> Food, wrong
            [0.2, 0.3, 0.5],  # -> Transport, wrong
        ]
        topk = metrics.compute_topk_recall(y_true, proba, self.LABELS, ks=(1,))
        y_pred = [self.LABELS[int(np.argmax(row))] for row in proba]
        plain = metrics.compute_classification_metrics(y_true, y_pred, labels=self.LABELS)
        assert topk["overall"]["top1"] == pytest.approx(plain["accuracy"])

    def test_macro_exposes_a_rare_class_the_overall_number_hides(self):
        # 9 Food rows always ranked 1st, 1 Rent row ranked last. Overall
        # top-1 is a flattering 90%; the macro average must be 50%,
        # because Rent's own top-1 recall is 0.
        y_true = ["Food"] * 9 + ["Rent"]
        proba = [[0.9, 0.05, 0.05]] * 9 + [[0.8, 0.05, 0.15]]
        result = metrics.compute_topk_recall(y_true, proba, self.LABELS, ks=(1,))
        assert result["overall"]["top1"] == pytest.approx(0.9)
        assert result["macro"]["top1"] == pytest.approx(0.5)
        assert result["perClass"]["Rent"]["top1"] == 0.0
        assert result["perClass"]["Food"]["top1"] == 1.0

    def test_a_class_with_zero_support_reports_none_not_zero(self):
        # None means "no rows to score", which is materially different
        # from 0.0 ("the model always missed it").
        y_true = ["Food", "Food"]
        proba = [[0.9, 0.05, 0.05], [0.8, 0.1, 0.1]]
        result = metrics.compute_topk_recall(y_true, proba, self.LABELS, ks=(1, 2))
        assert result["perClass"]["Rent"]["support"] == 0
        assert result["perClass"]["Rent"]["top1"] is None
        assert result["perClass"]["Food"]["support"] == 2
        # macro must average only the classes that actually had rows
        assert result["macro"]["top1"] == pytest.approx(1.0)

    def test_k_larger_than_class_count_is_clamped_and_deduplicated(self):
        y_true = ["Food"]
        proba = [[0.5, 0.3, 0.2]]
        result = metrics.compute_topk_recall(y_true, proba, self.LABELS, ks=(1, 3, 5, 20))
        # 5 and 20 both clamp to 3, which already exists -> [1, 3]
        assert result["ks"] == [1, 3]
        assert result["overall"]["top3"] == 1.0

    def test_true_label_outside_the_column_set_counts_as_a_miss(self):
        # A category the model was never trained on is a real coverage
        # failure; dropping the row would flatter every k.
        y_true = ["Food", "Crypto"]
        proba = [[0.9, 0.05, 0.05], [0.4, 0.4, 0.2]]
        result = metrics.compute_topk_recall(y_true, proba, self.LABELS, ks=(1, 3))
        assert result["overall"]["top1"] == pytest.approx(0.5)
        assert result["overall"]["top3"] == pytest.approx(0.5)  # still a miss at every k
        assert "Crypto" not in result["perClass"]

    def test_ranking_is_stable_for_tied_probabilities(self):
        # Equal probabilities must resolve in `labels` order every run,
        # so a persisted metric is reproducible rather than sort-dependent.
        y_true = ["Transport"]
        proba = [[1 / 3, 1 / 3, 1 / 3]]
        first = metrics.compute_topk_recall(y_true, proba, self.LABELS, ks=(1, 2, 3))
        second = metrics.compute_topk_recall(y_true, proba, self.LABELS, ks=(1, 2, 3))
        assert first == second
        assert first["overall"]["top1"] == 0.0  # Food wins the tie
        assert first["overall"]["top3"] == 1.0

    def test_rejects_a_proba_shape_that_disagrees_with_the_labels(self):
        with pytest.raises(ValueError, match="columns"):
            metrics.compute_topk_recall(["Food"], [[0.5, 0.5]], self.LABELS)

    def test_rejects_a_row_count_mismatch(self):
        with pytest.raises(ValueError, match="probability rows"):
            metrics.compute_topk_recall(["Food", "Rent"], [[0.5, 0.3, 0.2]], self.LABELS)

    def test_rejects_an_empty_split(self):
        with pytest.raises(ValueError, match="empty split"):
            metrics.compute_topk_recall([], np.empty((0, 3)), self.LABELS)

    def test_rejects_a_non_2d_proba(self):
        with pytest.raises(ValueError, match="2-D"):
            metrics.compute_topk_recall(["Food"], [0.5, 0.3, 0.2], self.LABELS)


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

    def test_includes_top_k_recall_when_proba_is_given(self):
        labels = ["Food", "Transport"]
        result = metrics.compute_full_metrics(
            ["Food", "Transport"],
            ["Food", "Transport"],
            labels=labels,
            proba=[[0.9, 0.1], [0.2, 0.8]],
            proba_labels=labels,
        )
        assert result["topKRecall"]["overall"]["top1"] == 1.0
        assert result["topKRecall"]["ks"] == [1, 2]

    def test_omits_top_k_recall_when_no_proba_given(self):
        result = metrics.compute_full_metrics(["Food"], ["Food"])
        assert "topKRecall" not in result

    def test_falls_back_to_explicit_labels_for_proba_columns(self):
        result = metrics.compute_full_metrics(
            ["Food"], ["Food"], labels=["Food", "Transport"], proba=[[0.9, 0.1]]
        )
        assert result["topKRecall"]["overall"]["top1"] == 1.0

    def test_rejects_proba_when_labels_were_never_given(self):
        # Column order would otherwise be inferred from whichever labels
        # happen to appear in y_true/y_pred -- silently wrong.
        with pytest.raises(ValueError, match="proba_labels"):
            metrics.compute_full_metrics(["Food"], ["Food"], proba=[[0.9, 0.1]])
