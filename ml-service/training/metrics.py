"""Py's RESULT["metrics"]). accuracy_score) -- a single number that hides exactly the failure mode a 15-category, class-imbalanced dataset (2,6."""

import numpy as np
from sklearn.metrics import (
    confusion_matrix as sk_confusion_matrix,
    f1_score,
    precision_recall_fscore_support,
)


def compute_classification_metrics(y_true, y_pred, labels=None):
    """Returns {"accuracy", "macroF1", "perClass": {label: {precision, recall, f1, support}}} for one set of true/predicted labels."""
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
    """]} -- matrix[i][j] is the count of true-label labels[i] predicted as labels[j]."""
    y_true = np.asarray(y_true)
    y_pred = np.asarray(y_pred)
    if labels is None:
        labels = sorted(set(y_true) | set(y_pred))
    matrix = sk_confusion_matrix(y_true, y_pred, labels=labels)
    return {"labels": [str(label) for label in labels], "matrix": matrix.tolist()}


def compute_calibration(y_true, y_pred, confidences, n_bins=10):
    """Reliability-diagram-style calibration over each prediction's max-class confidence: bins predictions by confidence into `n_bins` equal-width [0,1] bins, and within each bin reports how many predictions fell there, their average confidence, and their actual accuracy."""
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


DEFAULT_TOPK = (1, 3, 5)


def compute_topk_recall(y_true, proba, labels, ks=DEFAULT_TOPK):
    """Top-k recall: the share of rows whose TRUE label appears among the k highest-probability classes the model predicted for that row."""
    y_true = np.asarray(y_true)
    proba = np.asarray(proba, dtype=float)
    labels = list(labels)

    if y_true.size == 0:
        raise ValueError("compute_topk_recall: cannot score an empty split")
    if proba.ndim != 2:
        raise ValueError(
            "compute_topk_recall: proba must be a 2-D (n_samples, n_classes) array, got %d dimension(s)"
            % proba.ndim
        )
    if proba.shape[0] != y_true.shape[0]:
        raise ValueError(
            "compute_topk_recall: %d true labels but %d probability rows"
            % (y_true.shape[0], proba.shape[0])
        )
    if proba.shape[1] != len(labels):
        raise ValueError(
            "compute_topk_recall: proba has %d columns but %d labels were given -- "
            "`labels` must name proba's columns in order"
            % (proba.shape[1], len(labels))
        )

    n_classes = len(labels)
    resolved_ks = sorted({min(int(k), n_classes) for k in ks if int(k) >= 1})
    if not resolved_ks:
        raise ValueError("compute_topk_recall: ks must contain at least one k >= 1")

    # Rank every row's classes best-first.
    ranked = np.argsort(-proba, axis=1, kind="stable")
    label_to_column = {label: index for index, label in enumerate(labels)}

    # -1 marks a true label absent from `labels`: it can never equal a real
    # column index, so it misses at every k without any special-casing.
    true_columns = np.array([label_to_column.get(value, -1) for value in y_true])

    # hit_rank[i] = the 0-based position of row i's true class in its own
    # ranking, or n_classes when the label is unknown (never a hit).
    hit_rank = np.full(y_true.shape[0], n_classes, dtype=int)
    known = true_columns >= 0
    if known.any():
        matches = ranked[known] == true_columns[known][:, None]
        hit_rank[known] = np.argmax(matches, axis=1)
        # argmax returns 0 for an all-False row; force those to a miss.
        hit_rank[known] = np.where(matches.any(axis=1), hit_rank[known], n_classes)

    key = lambda k: "top%d" % k

    overall = {key(k): float((hit_rank < k).mean()) for k in resolved_ks}

    per_class = {}
    for label in labels:
        mask = y_true == label
        support = int(mask.sum())
        entry = {"support": support}
        for k in resolved_ks:
            # A class with no rows in this split has no recall to report.
            entry[key(k)] = float((hit_rank[mask] < k).mean()) if support else None
        per_class[label] = entry

    scored = [entry for entry in per_class.values() if entry["support"] > 0]
    macro = {
        key(k): (float(np.mean([entry[key(k)] for entry in scored])) if scored else 0.0)
        for k in resolved_ks
    }

    return {"overall": overall, "macro": macro, "perClass": per_class, "ks": resolved_ks}


def compute_full_metrics(
    y_true,
    y_pred,
    confidences=None,
    labels=None,
    n_bins=10,
    proba=None,
    proba_labels=None,
    ks=DEFAULT_TOPK,
):
    """Convenience wrapper bundling classification metrics + confusion matrix + (if confidences is provided) calibration + (if proba is provided) top-k recall into one dict ready to attach to a training run's persisted metrics/metadata."""
    explicit_labels = labels
    if labels is None:
        labels = sorted(set(np.asarray(y_true)) | set(np.asarray(y_pred)))

    result = compute_classification_metrics(y_true, y_pred, labels=labels)
    result["confusion"] = compute_confusion_matrix(y_true, y_pred, labels=labels)
    if confidences is not None:
        result["calibration"] = compute_calibration(y_true, y_pred, confidences, n_bins=n_bins)
    if proba is not None:
        columns = proba_labels if proba_labels is not None else explicit_labels
        if columns is None:
            raise ValueError(
                "compute_full_metrics: `proba_labels` (or an explicit `labels`) is required "
                "when `proba` is given -- proba's column order cannot be inferred from y_true/y_pred"
            )
        result["topKRecall"] = compute_topk_recall(y_true, proba, columns, ks=ks)
    return result
