"""Phase D validation gates."""

import os
import numpy as np

import model_bundle
import category_config

GATE_NAMES = [
    "completeness",
    "loadability",
    "feature_compatibility",
    "encoder_model_compatibility",
    "dataset_metadata_consistency",
    "valid_metrics",
    "regression_threshold",
    "smoke_predictions",
    "category_set_comparison",
]


def _result(gate, passed, reason=None, skipped=False):
    return {"gate": gate, "passed": passed, "reason": reason, "skipped": skipped}


def _skip_remaining(results, remaining_gates, reason):
    for gate in remaining_gates:
        results.append(_result(gate, passed=False, reason=reason, skipped=True))
    return results


def gate_completeness(model_version):
    """Json exists and is non-empty. is_bundle_complete so the completeness definition can never drift between the writer and the validator."""
    if model_bundle.is_bundle_complete(model_version):
        return _result("completeness", True)
    return _result(
        "completeness", False,
        "one or more of model.pkl / vectorizer.pkl / labelEncoder.pkl / "
        "metadata.json is missing or empty in the candidate bundle directory",
    )


def gate_loadability(model_version):
    """Gate 2: every artifact can actually be deserialized with joblib."""
    try:
        model, vectorizer, encoder = model_bundle.load_bundle(model_version)
        return _result("loadability", True), (model, vectorizer, encoder)
    except Exception as exc:
        return _result("loadability", False, f"joblib.load failed: {exc}"), None


def gate_feature_compatibility(vectorizer, model):
    """Gate 3: the vectorizer's output feature dimensionality matches what the model expects as input."""
    try:
        vocab = getattr(vectorizer, "vocabulary_", None)
        if vocab is None:
            return _result(
                "feature_compatibility", False,
                "vectorizer has no fitted vocabulary_ (was it actually fit?)",
            )
        vectorizer_features = len(vocab)

        model_features = getattr(model, "n_features_in_", None)
        if model_features is None:
            return _result(
                "feature_compatibility", False,
                "model has no n_features_in_ attribute (was it actually fit?)",
            )

        if vectorizer_features != model_features:
            return _result(
                "feature_compatibility", False,
                f"vectorizer produces {vectorizer_features} features but "
                f"model expects {model_features}",
            )
        return _result("feature_compatibility", True)
    except Exception as exc:
        return _result("feature_compatibility", False, f"unexpected error: {exc}")


def gate_encoder_model_compatibility(encoder, model):
    """Gate 4: the label encoder's class count matches the model's output
    class count."""
    try:
        encoder_classes = getattr(encoder, "classes_", None)
        if encoder_classes is None:
            return _result(
                "encoder_model_compatibility", False,
                "encoder has no fitted classes_ (was it actually fit?)",
            )

        model_classes = getattr(model, "classes_", None)
        if model_classes is None:
            return _result(
                "encoder_model_compatibility", False,
                "model has no fitted classes_ (was it actually fit?)",
            )

        if len(encoder_classes) != len(model_classes):
            return _result(
                "encoder_model_compatibility", False,
                f"encoder has {len(encoder_classes)} classes but model has "
                f"{len(model_classes)} classes",
            )
        return _result("encoder_model_compatibility", True)
    except Exception as exc:
        return _result(
            "encoder_model_compatibility", False, f"unexpected error: {exc}"
        )


def gate_dataset_metadata_consistency(metadata, expected_dataset_hash, expected_row_counts):
    """Py's snapshot) actually produced for this run. Catches the class of bug where a stale or wrong dataset was silently used."""
    if metadata.get("datasetHash") != expected_dataset_hash:
        return _result(
            "dataset_metadata_consistency", False,
            f"metadata datasetHash {metadata.get('datasetHash')!r} does not "
            f"match expected {expected_dataset_hash!r}",
        )
    if metadata.get("rowCounts") != expected_row_counts:
        return _result(
            "dataset_metadata_consistency", False,
            f"metadata rowCounts {metadata.get('rowCounts')!r} does not "
            f"match expected {expected_row_counts!r}",
        )
    return _result("dataset_metadata_consistency", True)


def gate_valid_metrics(metrics):
    """Gate 6: metrics dict is well-formed -- accuracy present, numeric, and within [0, 1]."""
    if not isinstance(metrics, dict):
        return _result("valid_metrics", False, "metrics is not a dict")

    accuracy = metrics.get("accuracy")
    if accuracy is None:
        return _result("valid_metrics", False, "metrics missing 'accuracy' key")

    try:
        accuracy = float(accuracy)
    except (TypeError, ValueError):
        return _result("valid_metrics", False, f"accuracy {accuracy!r} is not numeric")

    if np.isnan(accuracy) or np.isinf(accuracy):
        return _result("valid_metrics", False, f"accuracy is not finite: {accuracy!r}")

    if not (0.0 <= accuracy <= 1.0):
        return _result("valid_metrics", False, f"accuracy {accuracy} out of range [0, 1]")

    return _result("valid_metrics", True)


def gate_regression_threshold(metrics, previous_accuracy, max_regression):
    """G. 05 for 5 percentage points) relative to it."""
    if previous_accuracy is None:
        return _result(
            "regression_threshold", True, skipped=True,
            reason="no previous completed run to compare against (first run)",
        )

    accuracy = float(metrics["accuracy"])
    drop = previous_accuracy - accuracy
    if drop > max_regression:
        return _result(
            "regression_threshold", False,
            f"accuracy dropped by {drop:.4f} (previous={previous_accuracy:.4f}, "
            f"new={accuracy:.4f}), exceeding ML_MAX_ACCURACY_REGRESSION="
            f"{max_regression:.4f}",
        )
    return _result("regression_threshold", True)


def gate_smoke_predictions(model, vectorizer, encoder, smoke_inputs=None):
    """Inverse_transform) runs end-to-end without raising, on a small fixed set of representative smoke inputs, and produces a known category string for each."""
    if smoke_inputs is None:
        smoke_inputs = ["coffee", "uber ride", "electric bill", "rent payment"]

    try:
        vectors = vectorizer.transform(smoke_inputs)
        predictions = model.predict(vectors)
        labels = encoder.inverse_transform(predictions)
        if len(labels) != len(smoke_inputs):
            return _result(
                "smoke_predictions", False,
                f"expected {len(smoke_inputs)} predictions, got {len(labels)}",
            )
        for label in labels:
            if label is None or str(label).strip() == "":
                return _result(
                    "smoke_predictions", False,
                    f"pipeline produced an empty/None label: {label!r}",
                )
        return _result("smoke_predictions", True)
    except Exception as exc:
        return _result("smoke_predictions", False, f"smoke prediction pipeline raised: {exc}")


def gate_category_set_comparison(encoder_classes, previous_categories):
    """Gate 9: compares the new model's category set against the previous completed run's category set (both normalized via category_config)."""
    if previous_categories is None:
        return _result(
            "category_set_comparison", True, skipped=True,
            reason="no previous completed run to compare against (first run)",
        )

    new_set = {category_config.normalize_category(c) or c for c in encoder_classes}
    previous_set = {category_config.normalize_category(c) or c for c in previous_categories}

    missing = previous_set - new_set
    if missing:
        return _result(
            "category_set_comparison", False,
            f"previously-supported categories missing from new model: "
            f"{sorted(missing)}",
        )
    return _result("category_set_comparison", True)


def run_all_gates(
    model_version,
    expected_dataset_hash,
    expected_row_counts,
    previous_accuracy,
    previous_categories,
    max_regression,
):
    """Runs all 9 gates in order against the on-disk candidate bundle at `model_version`."""
    results = []

    completeness = gate_completeness(model_version)
    results.append(completeness)
    if not completeness["passed"]:
        return False, _skip_remaining(
            results, GATE_NAMES[1:], "skipped: completeness gate failed"
        )

    loadability, loaded = gate_loadability(model_version)
    results.append(loadability)
    if not loadability["passed"]:
        return False, _skip_remaining(
            results, GATE_NAMES[2:], "skipped: loadability gate failed"
        )
    model, vectorizer, encoder = loaded

    feature_compat = gate_feature_compatibility(vectorizer, model)
    results.append(feature_compat)
    if not feature_compat["passed"]:
        return False, _skip_remaining(
            results, GATE_NAMES[3:], "skipped: feature_compatibility gate failed"
        )

    encoder_compat = gate_encoder_model_compatibility(encoder, model)
    results.append(encoder_compat)
    if not encoder_compat["passed"]:
        return False, _skip_remaining(
            results, GATE_NAMES[4:], "skipped: encoder_model_compatibility gate failed"
        )

    metadata = model_bundle.read_metadata(model_version)

    dataset_consistency = gate_dataset_metadata_consistency(
        metadata, expected_dataset_hash, expected_row_counts
    )
    results.append(dataset_consistency)
    if not dataset_consistency["passed"]:
        return False, _skip_remaining(
            results, GATE_NAMES[5:], "skipped: dataset_metadata_consistency gate failed"
        )

    valid_metrics = gate_valid_metrics(metadata.get("metrics", {}))
    results.append(valid_metrics)
    if not valid_metrics["passed"]:
        return False, _skip_remaining(
            results, GATE_NAMES[6:], "skipped: valid_metrics gate failed"
        )

    regression = gate_regression_threshold(
        metadata["metrics"], previous_accuracy, max_regression
    )
    results.append(regression)
    if not regression["passed"] and not regression["skipped"]:
        return False, _skip_remaining(
            results, GATE_NAMES[7:], "skipped: regression_threshold gate failed"
        )

    smoke = gate_smoke_predictions(model, vectorizer, encoder)
    results.append(smoke)
    if not smoke["passed"]:
        return False, _skip_remaining(
            results, GATE_NAMES[8:], "skipped: smoke_predictions gate failed"
        )

    category_comparison = gate_category_set_comparison(
        metadata.get("encoderClasses", []), previous_categories
    )
    results.append(category_comparison)
    if not category_comparison["passed"] and not category_comparison["skipped"]:
        return False, results

    return True, results
