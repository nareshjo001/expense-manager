"""
ML-001-T05 -- macro-F1, per-class metrics, confusion matrix, and
calibration, computed and shaped for persistence alongside a training
run's other metadata (model_bundle.py's metadata.json / trainer.py's
RESULT["metrics"]).

Before this, trainer.py only ever computed and persisted overall
accuracy (sklearn.metrics.accuracy_score) -- a single number that hides
exactly the failure mode a 15-category, class-imbalanced dataset (2,635
Food rows vs 528 Rent rows, per ML-001-T02's group counts) is prone to:
a model that's very good at the big categories and quietly bad at the
small ones can still post a high overall accuracy. Macro-F1 (each
class's F1 weighted equally, not by its row count) and the per-class
breakdown below are what actually surface that.
"""

import numpy as np
from sklearn.metrics import (
    confusion_matrix as sk_confusion_matrix,
    f1_score,
    precision_recall_fscore_support,
)


def compute_classification_metrics(y_true, y_pred, labels=None):
    """
    Returns {"accuracy", "macroF1", "perClass": {label: {precision,
    recall, f1, support}}} for one set of true/predicted labels.
    `labels` fixes the class ordering/inclusion (e.g. every canonical
    category, even one with zero support in this split) -- defaults to
    every label observed in y_true/y_pred.
    """
    y_true = np.asarray(y_true)
    y_pred = np.asarray(y_pred)
    if len(y_true) != len(y_pred):
        raise ValueError(
            f"compute_classification_metrics: {len(y_true)} true labels vs {len(y_pred)} predictions"
        )
    if len(y_true) == 0:
        raise ValueError("compute_classification_metrics: cannot score an empty split")

    if labels is None:
        labels = sorted(set(y_true) | set(y_pred))

    accuracy = float(np.mean(y_true == y_pred))
    macro_f1 = float(f1_score(y_true, y_pred, labels=labels, average="macro", zero_division=0))

    precision, recall, f1, support = precision_recall_fscore_support(
        y_true, y_pred, labels=labels, average=None, zero_division=0
    )

    per_class = {
        str(label): {
            "precision": float(precision[i]),
            "recall": float(recall[i]),
            "f1": float(f1[i]),
            "support": int(support[i]),
        }
        for i, label in enumerate(labels)
    }

    return {"accuracy": accuracy, "macroF1": macro_f1, "perClass": per_class}


def compute_confusion_matrix(y_true, y_pred, labels=None):
    """
    Returns {"labels": [...], "matrix": [[...], ...]} -- matrix[i][j] is
    the count of true-label labels[i] predicted as labels[j]. Row/column
    order is `labels`, so this stays readable in a persisted JSON file
    without a separate lookup.
    """
    y_true = np.asarray(y_true)
    y_pred = np.asarray(y_pred)
    if labels is None:
        labels = sorted(set(y_true) | set(y_pred))
    matrix = sk_confusion_matrix(y_true, y_pred, labels=labels)
    return {"labels": [str(label) for label in labels], "matrix": matrix.tolist()}


def compute_calibration(y_true, y_pred, confidences, n_bins=10):
    """
    Reliability-diagram-style calibration over each prediction's
    max-class confidence: bins predictions by confidence into `n_bins`
    equal-width [0,1] bins, and within each bin reports how many
    predictions fell there, their average confidence, and their actual
    accuracy. A well-calibrated model has avgConfidence ~= accuracy in
    every populated bin. Also returns the overall Expected Calibration
    Error (ECE): the accuracy-weighted average |avgConfidence -
    accuracy| across populated bins -- lower is better, 0 is perfect.

    `confidences` is the model's predicted probability for whichever
    class it actually predicted (i.e. `proba.max(axis=1)`, computed by
    the caller from predict_proba's output) -- this module takes the
    already-extracted array so it has no dependency on any particular
    model's predict_proba shape/column order.
    """
    y_true = np.asarray(y_true)
    y_pred = np.asarray(y_pred)
    confidences = np.asarray(confidences, dtype=float)
    n = len(y_true)
    if not (len(y_pred) == len(confidences) == n):
        raise ValueError(
            f"compute_calibration: {n} true labels, {len(y_pred)} predictions, "
            f"{len(confidences)} confidences must all match"
        )
    if n == 0:
        raise ValueError("compute_calibration: cannot score an empty split")
    if np.any((confidences < 0) | (confidences > 1)):
        raise ValueError("compute_calibration: confidences must all be in [0, 1]")

    correct = (y_true == y_pred)
    bin_edges = np.linspace(0.0, 1.0, n_bins + 1)
    # Rightmost bin includes 1.0 itself.
    bin_indices = np.clip(np.digitize(confidences, bin_edges[1:-1], right=True), 0, n_bins - 1)

    bins = []
    ece_numerator = 0.0
    for b in range(n_bins):
        mask = bin_indices == b
        count = int(mask.sum())
        if count == 0:
            bins.append({
                "rangeLow": float(bin_edges[b]),
                "rangeHigh": float(bin_edges[b + 1]),
                "count": 0,
                "avgConfidence": None,
                "accuracy": None,
            })
            continue
        avg_confidence = float(confidences[mask].mean())
        bin_accuracy = float(correct[mask].mean())
        bins.append({
            "rangeLow": float(bin_edges[b]),
            "rangeHigh": float(bin_edges[b + 1]),
            "count": count,
            "avgConfidence": avg_confidence,
            "accuracy": bin_accuracy,
        })
        ece_numerator += count * abs(avg_confidence - bin_accuracy)

    expected_calibration_error = float(ece_numerator / n)

    return {"bins": bins, "expectedCalibrationError": expected_calibration_error}


def compute_full_metrics(y_true, y_pred, confidences=None, labels=None, n_bins=10):
    """
    Convenience wrapper bundling classification metrics + confusion
    matrix + (if confidences is provided) calibration into one dict
    ready to attach to a training run's persisted metrics/metadata.
    Calibration is omitted (not defaulted to a fake value) when the
    caller has no confidences to give -- e.g. a baseline model with no
    meaningful predict_proba.
    """
    if labels is None:
        labels = sorted(set(np.asarray(y_true)) | set(np.asarray(y_pred)))

    result = compute_classification_metrics(y_true, y_pred, labels=labels)
    result["confusion"] = compute_confusion_matrix(y_true, y_pred, labels=labels)
    if confidences is not None:
        result["calibration"] = compute_calibration(y_true, y_pred, confidences, n_bins=n_bins)
    return result
