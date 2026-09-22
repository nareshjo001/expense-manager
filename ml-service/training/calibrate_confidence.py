"""
ML-003-T01 -- calibrate the currently-served model's confidence on a
grouped, held-out validation split.

WHAT THIS SCRIPT ACTUALLY MEASURES

"Confidence" today (inference/predictor.py:47) is just
`max(predict_proba(x))` -- the model's own probability estimate for
whatever it predicted, reported to the user unmodified. A RandomForest's
predict_proba is a vote share, not a calibrated probability: nothing
guarantees that "80% confident" predictions are actually right 80% of
the time. ML-003's whole premise is that this raw number is not
trustworthy enough to gate an abstention decision on without measuring
it first.

This script loads the CURRENTLY-SERVING legacy bundle -- the exact
model.pkl / vectorizer.pkl / labelEncoder.pkl inference/predictor_manager.py
falls back to at startup when no versioned manifest exists (see its
LEGACY_MODEL_PATH/LEGACY_VECTORIZER_PATH/LEGACY_ENCODER_PATH) -- and scores
it against a held-out slice of usedDatasets/merged_expenses.csv, split with
the SAME grouped, leakage-free methodology training/grouped_split.py uses
for real training runs (ML-001-T03): every row's group key is its
post-cleaning expenseName + normalized category, and no group crosses the
train/val/test boundary. That matters here specifically because 77% of this
dataset is exact-duplicate rows (ML-001-T02's finding) -- an ungrouped
random split would let the model see near-identical rows in both "training"
and "validation", making every confidence number this script would report
optimistic in a way that defeats the entire point of calibrating it.

METHODOLOGY CAVEAT, STATED PLAINLY

There is no metadata.json for this legacy bundle (model_bundle.py's own
comment: it predates the versioned-bundle system and carries no recorded
training run). So this script cannot prove the validation fold below is
disjoint from whatever rows the legacy model actually trained on -- only
that it is disjoint under the same grouping key a real training run would
use. If the legacy model happens to have trained on this exact CSV with an
ungrouped split, these numbers are somewhat optimistic. This is the honest
ceiling on what "calibrate the legacy model" can mean without a recorded
manifest, and is exactly why ML-003-T02's per-class thresholds should be
re-derived from a real training run's OWN held-out split (which model_bundle
now records) the next time this model is retrained, rather than trusted
as permanent.

WHAT THIS SCRIPT DOES NOT DO

It does not retrain, touch predictor.py, or change any served behavior.
It is read-only analysis producing a JSON report + a human-readable
console summary -- ML-003-T02 (turning "per-class calibration bins" into
an actual per-class abstain threshold definition) and T03 (wiring an
abstain flag into the API contract) are separate, not-yet-started tasks
that consume this report's output.

Run from the ml-service/ directory: `python training/calibrate_confidence.py`
"""
import argparse
import json
import os
import sys
import warnings

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
import category_config  # noqa: E402
import grouped_split  # noqa: E402
import metrics as ml_metrics  # noqa: E402
import model_bundle  # noqa: E402

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATASET = os.path.join(BASE_DIR, "..", "usedDatasets", "merged_expenses.csv")
DEFAULT_REPORT_PATH = os.path.join(BASE_DIR, "calibration_report.json")

# The legacy artifacts predictor_manager.py falls back to -- see this
# module's own docstring for why these specific three files, not
# model_bundle.bundle_dir(), are the right target.
LEGACY_MODEL_PATH = os.path.join(BASE_DIR, "model.pkl")
LEGACY_VECTORIZER_PATH = os.path.join(BASE_DIR, "vectorizer.pkl")
LEGACY_ENCODER_PATH = os.path.join(BASE_DIR, "labelEncoder.pkl")

# Candidate per-class thresholds this script screens: the lowest one where
# precision-at-and-above-threshold still meets each precision target below.
# 0.05 steps are fine granularity for a 15-class, few-thousand-row eval --
# finer than the data can actually resolve would be false precision.
THRESHOLD_GRID = np.round(np.arange(0.30, 1.0001, 0.05), 2)
PRECISION_TARGETS = (0.80, 0.90, 0.95)


def _clean_text(series):
    # Mirrors trainer.py's own cleaning pass exactly -- this MUST match
    # what the model was actually trained on, or the vectorizer sees
    # different text than it was fit on and every downstream number is
    # meaningless.
    cleaned = series.astype(str).str.lower().str.strip()
    cleaned = cleaned.str.replace(r"[^a-zA-Z0-9\s]", "", regex=True)
    cleaned = cleaned.str.replace(r"\s+", " ", regex=True)
    return cleaned


def load_validation_split(dataset_path, random_state=42):
    df = pd.read_csv(dataset_path)

    required = {"expenseName", "expenseCategory"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"dataset missing required column(s): {sorted(missing)}")

    df["expenseName"] = _clean_text(df["expenseName"])
    df["expenseCategory"] = (
        df["expenseCategory"].astype(str).str.lower().str.strip().map(category_config.CATEGORY_ALIASES)
    )
    before = len(df)
    df = df.dropna(subset=["expenseCategory"])
    df = df[df["expenseName"].str.len() > 0]
    dropped = before - len(df)

    group_keys = grouped_split.make_group_key(df["expenseName"].values, df["expenseCategory"].values)
    y = df["expenseCategory"].values

    train_idx, val_idx, test_idx, strategy = grouped_split.grouped_train_val_test_split(
        y, group_keys, random_state=random_state
    )
    grouped_split.assert_no_group_leakage(group_keys, train_idx, val_idx, test_idx)

    return df, val_idx, strategy, dropped, before


def load_legacy_bundle():
    for path in (LEGACY_MODEL_PATH, LEGACY_VECTORIZER_PATH, LEGACY_ENCODER_PATH):
        if not os.path.isfile(path):
            raise FileNotFoundError(f"legacy artifact missing: {path}")
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        model = model_bundle.joblib.load(LEGACY_MODEL_PATH)
        vectorizer = model_bundle.joblib.load(LEGACY_VECTORIZER_PATH)
        encoder = model_bundle.joblib.load(LEGACY_ENCODER_PATH)
        version_warnings = [str(w.message) for w in caught if "Inconsistent" in str(w.category.__name__)]
    return model, vectorizer, encoder, version_warnings


def precision_at_threshold(y_true_bin, confidences, threshold):
    """
    Among predictions of ONE class with confidence >= threshold, what
    fraction were actually correct? `y_true_bin` is a boolean array,
    True where the true label equals the class being screened (so this
    is precision for that class specifically, not overall accuracy).
    Returns (precision, coverage_count) -- coverage_count is how many
    predictions clear the bar, since a threshold with high precision but
    near-zero coverage is not a usable threshold.
    """
    mask = confidences >= threshold
    covered = int(mask.sum())
    if covered == 0:
        return None, 0
    precision = float(y_true_bin[mask].mean())
    return precision, covered


def suggest_threshold(y_true_class_mask, confidences, targets=PRECISION_TARGETS):
    """
    For each precision target, the LOWEST grid threshold at or above
    which precision-at-and-above-threshold meets that target -- i.e. the
    most permissive (highest-coverage) threshold that still clears the
    bar. None if no grid point clears it even at 1.0 confidence (the
    class is not separable enough for that target at all).
    """
    curve = []
    for t in THRESHOLD_GRID:
        precision, covered = precision_at_threshold(y_true_class_mask, confidences, t)
        curve.append({"threshold": float(t), "precision": precision, "coverage": covered})

    suggestions = {}
    for target in targets:
        chosen = None
        for point in curve:
            if point["precision"] is not None and point["precision"] >= target:
                chosen = point["threshold"]
                break
        suggestions[f"p{int(target * 100)}"] = chosen
    return curve, suggestions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", default=DEFAULT_DATASET)
    parser.add_argument("--report-path", default=DEFAULT_REPORT_PATH)
    parser.add_argument("--random-state", type=int, default=42)
    args = parser.parse_args()

    print(f"Loading legacy bundle (model.pkl / vectorizer.pkl / labelEncoder.pkl)...")
    model, vectorizer, encoder, version_warnings = load_legacy_bundle()
    print(f"  loaded. canonical classes: {list(encoder.classes_)}")
    if version_warnings:
        print(f"  NOTE: {len(version_warnings)} scikit-learn version-mismatch warning(s) "
              f"during unpickling (see report JSON's sklearnVersionWarnings) -- "
              f"functioned correctly here, flagged for the record, not treated as fatal.")

    print(f"\nLoading + grouped-splitting {args.dataset} ...")
    df, val_idx, strategy, dropped, total_after_clean = load_validation_split(
        args.dataset, random_state=args.random_state
    )
    print(f"  split strategy: {strategy}")
    print(f"  usable rows after cleaning: {total_after_clean} ({dropped} dropped as unmapped/empty)")
    print(f"  validation fold size: {len(val_idx)}")

    val_df = df.iloc[val_idx]
    X_val = vectorizer.transform(val_df["expenseName"])
    proba = model.predict_proba(X_val)
    pred_encoded = model.predict(X_val)
    y_pred = encoder.inverse_transform(pred_encoded)
    y_true = val_df["expenseCategory"].values
    confidences = proba.max(axis=1)

    proba_labels = list(encoder.inverse_transform(model.classes_))

    overall = ml_metrics.compute_full_metrics(
        y_true, y_pred, confidences=confidences, labels=category_config.CANONICAL_CATEGORIES,
        proba=proba, proba_labels=proba_labels,
    )

    print(f"\nOVERALL (validation fold, n={len(val_idx)}):")
    print(f"  accuracy={overall['accuracy']:.4f}  macroF1={overall['macroF1']:.4f}  "
          f"ECE={overall['calibration']['expectedCalibrationError']:.4f}")

    per_class_report = {}
    print(f"\nPER-CLASS calibration (precision of a PREDICTED class at increasing confidence):")
    print(f"  {'class':<15} {'support':>8} {'raw-prec':>9} {'p80':>7} {'p90':>7} {'p95':>7}")
    for cls in category_config.CANONICAL_CATEGORIES:
        pred_mask = y_pred == cls
        support = int(pred_mask.sum())
        if support == 0:
            per_class_report[cls] = {
                "predictedCount": 0, "rawPrecision": None, "curve": [], "suggestedThresholds": {},
            }
            print(f"  {cls:<15} {support:>8} {'--':>9} {'--':>7} {'--':>7} {'--':>7}")
            continue

        cls_confidences = confidences[pred_mask]
        cls_true_bin = (y_true[pred_mask] == cls)
        raw_precision = float(cls_true_bin.mean())
        curve, suggestions = suggest_threshold(cls_true_bin, cls_confidences)

        per_class_report[cls] = {
            "predictedCount": support,
            "rawPrecision": raw_precision,
            "curve": curve,
            "suggestedThresholds": suggestions,
        }

        def fmt(v):
            return f"{v:.2f}" if v is not None else "n/a"

        print(f"  {cls:<15} {support:>8} {raw_precision:>9.3f} "
              f"{fmt(suggestions['p80']):>7} {fmt(suggestions['p90']):>7} {fmt(suggestions['p95']):>7}")

    report = {
        "task": "ML-003-T01",
        "legacyBundle": {
            "modelPath": os.path.relpath(LEGACY_MODEL_PATH, BASE_DIR),
            "vectorizerPath": os.path.relpath(LEGACY_VECTORIZER_PATH, BASE_DIR),
            "encoderPath": os.path.relpath(LEGACY_ENCODER_PATH, BASE_DIR),
            "sklearnVersionWarnings": version_warnings,
        },
        "dataset": {
            "path": os.path.relpath(args.dataset, BASE_DIR),
            "usableRowsAfterCleaning": total_after_clean,
            "droppedRows": dropped,
            "splitStrategy": strategy,
            "validationFoldSize": len(val_idx),
        },
        "methodologyCaveat": (
            "No metadata.json/manifest exists for this legacy bundle, so this validation "
            "fold's disjointness from the legacy model's actual (unrecorded) training data "
            "cannot be proven -- only that it is disjoint under grouped_split's group key. "
            "Re-derive from a real training run's own recorded split once this model is "
            "next retrained through the versioned pipeline."
        ),
        "overall": overall,
        "perClass": per_class_report,
        "precisionTargets": list(PRECISION_TARGETS),
        "thresholdGrid": [float(t) for t in THRESHOLD_GRID],
    }

    with open(args.report_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
    print(f"\nFull report written to {args.report_path}")


if __name__ == "__main__":
    main()
