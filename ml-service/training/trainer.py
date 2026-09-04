import os
import sys
import json
import time
import argparse
import numpy as np
import pandas as pd

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import LabelEncoder
from sklearn.ensemble import RandomForestClassifier

from sklearn.model_selection import train_test_split

import category_config
import model_bundle
# ML-001-T03/T04/T05 -- grouped splitting (prevents duplicate rows from
# leaking across train/val/test, see grouped_split.py's own docstring),
# baseline comparisons, and the fuller metric set (macro-F1, per-class,
# confusion, calibration) beyond the single accuracy number this file
# used to report.
import grouped_split
import baselines
import metrics as ml_metrics

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Writes an immutable versioned bundle (see STEP 10); never touches the fixed model.pkl/vectorizer.pkl/labelEncoder.pkl inference/predictor.py reads.


def _parse_args():
    """
    Phase D adds the CLI surface needed to produce a versioned, traceable
    candidate bundle and a structured result file the orchestrator
    (training/retrain_pipeline.py) can read back, on top of Phase C's
    --dataset argument. All of these are required except
    --previous-accuracy (absent/omitted means "no baseline exists yet",
    per Phase D's explicit no-invented-baseline rule) -- there is no
    fallback/default for any of the required ones; a missing required
    argument is a controlled, non-zero exit (argparse's own usage error,
    exit code 2).
    """
    parser = argparse.ArgumentParser(
        description="Train the expense-category model from a specific, "
                     "already-assembled dataset snapshot, and write an "
                     "immutable versioned candidate bundle."
    )
    parser.add_argument(
        "--dataset",
        required=True,
        help="Path to the run-specific immutable training dataset CSV "
             "produced by training/dataset_builder.py. Required -- there is "
             "no fallback to a shared dataset file."
    )
    parser.add_argument(
        "--run-id",
        required=True,
        help="The training run id (mltrainingruns._id) this invocation "
             "belongs to. Recorded in the candidate bundle's metadata.json."
    )
    parser.add_argument(
        "--model-version",
        required=True,
        help="The model version identifier for the candidate bundle "
             "(model_bundle.model_version_for_run(run_id))."
    )
    parser.add_argument(
        "--dataset-hash",
        required=True,
        help="SHA-256 hash of the dataset snapshot (from "
             "dataset_builder.build_snapshot_for_run), recorded in "
             "metadata.json so validate_model.py's dataset/metadata "
             "consistency gate has something authoritative to compare "
             "against."
    )
    parser.add_argument(
        "--row-counts-json",
        required=True,
        help="JSON object of the dataset snapshot's row counts (from "
             "dataset_builder.build_snapshot_for_run), recorded in "
             "metadata.json for the same reason as --dataset-hash."
    )
    parser.add_argument(
        "--previous-accuracy",
        default=None,
        help="Accuracy of the most recent completed training run, if any. "
             "Omitted entirely when no such run exists (first run) -- no "
             "baseline is invented. Recorded in metrics for traceability "
             "only; the regression comparison itself happens later, in "
             "validate_model.py, not here."
    )
    parser.add_argument(
        "--result-path",
        required=True,
        help="Path to write this script's structured JSON result to."
    )
    return parser.parse_args()


ARGS = _parse_args()
DATASET_PATH = ARGS.dataset

RESULT = {
    "success": False,
    "modelVersion": ARGS.model_version,
    "artifactPath": None,
    "metrics": None,
    "encoderClasses": None,
    "error": None,
}


def _write_result_and_exit(exit_code):
    try:
        with open(ARGS.result_path, "w", encoding="utf-8") as fh:
            json.dump(RESULT, fh, indent=2)
    except Exception as exc:
        # Worse than an ordinary training error (which IS captured in the result file) -- also surface on stderr.
        sys.stderr.write(f"FAILED TO WRITE RESULT FILE: {exc}\n")
    sys.exit(exit_code)


if not os.path.isfile(DATASET_PATH):
    print(f"ERROR: dataset file not found at {DATASET_PATH}")
    RESULT["error"] = f"dataset file not found at {DATASET_PATH}"
    _write_result_and_exit(2)

try:
    ROW_COUNTS = json.loads(ARGS.row_counts_json)
except json.JSONDecodeError as exc:
    print(f"ERROR: invalid --row-counts-json: {exc}")
    RESULT["error"] = f"invalid --row-counts-json: {exc}"
    _write_result_and_exit(2)

PREVIOUS_ACCURACY = (
    float(ARGS.previous_accuracy) if ARGS.previous_accuracy is not None else None
)

print("\nLOADING DATASET...")

try:
    df = pd.read_csv(DATASET_PATH)

    print("DATASET LOADED SUCCESSFULLY\n")

except Exception as e:
    print("ERROR LOADING DATASET:", e)
    RESULT["error"] = f"error loading dataset: {e}"
    _write_result_and_exit(1)

REQUIRED_COLUMNS = {"expenseName", "expenseCategory"}
missing_columns = REQUIRED_COLUMNS - set(df.columns)
if missing_columns:
    print(f"ERROR: dataset is missing required column(s): {sorted(missing_columns)}")
    RESULT["error"] = f"dataset missing required column(s): {sorted(missing_columns)}"
    _write_result_and_exit(2)

print("CLEANING TEXT...")

df["expenseName"] = (
    df["expenseName"]
    .astype(str)
    .str.lower()
    .str.strip()
    .str.replace(r"[^a-zA-Z0-9\s]", "", regex=True)
)

df["expenseName"] = (
    df["expenseName"]
    .str.replace(r"\s+", " ", regex=True)
)

print("TEXT CLEANING COMPLETED")

print("\nNORMALIZING CATEGORIES...")

df["expenseCategory"] = (
    df["expenseCategory"]
    .astype(str)
    .str.lower()
    .str.strip()
)

# Shared with training/dataset_builder.py's feedback validation so the two normalizations cannot drift apart.
CATEGORY_MAPPING = category_config.CATEGORY_ALIASES

df["expenseCategory"] = df["expenseCategory"].map(
    CATEGORY_MAPPING
)

df = df.dropna(subset=["expenseCategory"])

print("CATEGORY NORMALIZATION COMPLETED\n")

print("TF-IDF VECTORIZATION...")

vectorizer = TfidfVectorizer(
    max_features=1000
)

X = vectorizer.fit_transform(df["expenseName"])

print("TF-IDF COMPLETED\n")

print("ENCODING LABELS...")

encoder = LabelEncoder()

y = encoder.fit_transform(df["expenseCategory"])

print("LABEL ENCODING COMPLETED\n")

print("BUILDING GROUP KEYS...")

# ML-001-T03 -- the dedup boundary for splitting is the SAME text the
# model actually trains on (post-cleaning expenseName) joined with the
# normalized category, not the raw input -- see grouped_split.py's
# module docstring for why (ML-001-T02's 77%-duplicate-rows finding).
group_keys = grouped_split.make_group_key(df["expenseName"].values, df["expenseCategory"].values)
text_values = df["expenseName"].values

print("GROUP KEY BUILD COMPLETED\n")

print("GROUPED TRAIN/VALIDATION/TEST SPLIT...")

train_idx, val_idx, test_idx, split_strategy = grouped_split.grouped_train_val_test_split(
    y, group_keys, random_state=42
)

fallback_split_used = split_strategy != grouped_split.STRATEGY_STRATIFIED_GROUP
if fallback_split_used:
    print(f"SPLIT STRATEGY DEGRADED TO: {split_strategy} (stratified-group splitting was infeasible on this dataset)\n")

try:
    grouped_split.assert_no_group_leakage(group_keys, train_idx, val_idx, test_idx)
except AssertionError as e:
    # Only reachable if even the fallback strategies couldn't guarantee
    # grouping -- surfaced loudly rather than silently trusted.
    print(f"WARNING: {e}\n")

X_train, y_train = X[train_idx], y[train_idx]
X_val, y_val = X[val_idx], y[val_idx]
X_test, y_test = X[test_idx], y[test_idx]
text_train = text_values[train_idx]
text_val = text_values[val_idx]

print("TRAIN SIZE:", X_train.shape[0])
print("VAL SIZE  :", X_val.shape[0])
print("TEST SIZE :", X_test.shape[0])

print("\nCREATING RANDOM FOREST MODEL...")

model = RandomForestClassifier(
    n_estimators=30,
    random_state=42,
    n_jobs=1,
)

print("MODEL CREATED")

start = time.time()

print("\nTRAINING MODEL...")

try:

    model.fit(X_train, y_train)

    training_seconds = time.time() - start

    print(f"TRAINING FINISHED IN {training_seconds:.2f} sec")

    print("\nMODEL TRAINING COMPLETED")

except Exception as e:

    print("\nTRAINING ERROR:", e)
    RESULT["error"] = f"training error: {e}"
    _write_result_and_exit(1)

# An evaluation failure does not stop the bundle save below -- validate_model.py's gate 6 rejects a bundle with no valid metrics.
print("\nEVALUATING MODEL...")

metrics = None

try:

    y_pred = model.predict(X_test)

    accuracy = float((y_test == y_pred).mean())

    print("MODEL ACCURACY:", round(accuracy * 100, 2), "%")

    # ML-001-T05 -- macro-F1, per-class precision/recall/f1, a full
    # confusion matrix, and calibration (from predict_proba's per-row max
    # probability), computed on the TEST split -- the one split nothing
    # above this point has touched for model selection, per standard
    # practice. Decoded back to real category names via the label
    # encoder so the persisted metrics are human-readable, not "class 7".
    y_test_names = encoder.inverse_transform(y_test)
    y_pred_names = encoder.inverse_transform(y_pred)
    class_names = list(encoder.classes_)

    proba = model.predict_proba(X_test)
    confidences = proba.max(axis=1)

    full_metrics = ml_metrics.compute_full_metrics(
        y_test_names, y_pred_names, confidences=confidences, labels=class_names
    )
    print("MACRO F1:", round(full_metrics["macroF1"] * 100, 2), "%")
    print("CALIBRATION (ECE):", round(full_metrics["calibration"]["expectedCalibrationError"], 4))

    metrics = {
        "accuracy": float(accuracy),
        "macroF1": full_metrics["macroF1"],
        "perClass": full_metrics["perClass"],
        "confusion": full_metrics["confusion"],
        "calibration": full_metrics["calibration"],
        "trainRows": int(X_train.shape[0]),
        "valRows": int(X_val.shape[0]),
        "testRows": int(X_test.shape[0]),
        "trainingSeconds": round(training_seconds, 2),
        "fallbackSplitUsed": fallback_split_used,
        "splitStrategy": split_strategy,
    }
    if PREVIOUS_ACCURACY is not None:
        metrics["previousAccuracy"] = PREVIOUS_ACCURACY

    # ML-001-T04 -- baseline comparison, evaluated on the VALIDATION
    # split (kept separate from the test split used above, per standard
    # practice: val is for model comparison/selection, test stays
    # untouched for the model's own headline number). Informative only --
    # a baseline failure never blocks saving the real model's bundle.
    print("\nEVALUATING BASELINES (validation split)...")
    try:
        y_train_names = encoder.inverse_transform(y_train)
        y_val_names = encoder.inverse_transform(y_val)

        built_baselines = baselines.build_all_baselines()

        built_baselines["majority"].fit(y_train_names)
        majority_pred = built_baselines["majority"].predict(len(y_val_names))
        majority_metrics = ml_metrics.compute_classification_metrics(
            y_val_names, majority_pred, labels=class_names
        )

        built_baselines["keyword"].fit(text_train, y_train_names)
        keyword_pred = built_baselines["keyword"].predict(text_val)
        keyword_metrics = ml_metrics.compute_classification_metrics(
            y_val_names, keyword_pred, labels=class_names
        )

        built_baselines["linear"].fit(X_train, y_train_names)
        linear_pred = built_baselines["linear"].predict(X_val)
        linear_metrics = ml_metrics.compute_classification_metrics(
            y_val_names, linear_pred, labels=class_names
        )

        baseline_results = {
            "majority": majority_metrics,
            "keyword": keyword_metrics,
            "linear": linear_metrics,
        }
        for name, result in baseline_results.items():
            print(
                f"  {name}: accuracy={round(result['accuracy'] * 100, 2)}% "
                f"macroF1={round(result['macroF1'] * 100, 2)}%"
            )

        metrics["baselines"] = {
            name: {"accuracy": result["accuracy"], "macroF1": result["macroF1"]}
            for name, result in baseline_results.items()
        }
    except Exception as e:
        print("BASELINE EVALUATION ERROR (non-fatal):", e)
        metrics["baselinesError"] = str(e)

except Exception as e:

    print("EVALUATION ERROR:", e)
    RESULT["error"] = f"evaluation error: {e}"

# Writes an immutable versioned bundle; never touches the fixed model.pkl/vectorizer.pkl/labelEncoder.pkl inference/predictor.py loads.
print("\nSAVING MODEL BUNDLE...")

try:

    metadata = model_bundle.build_metadata(
        run_id=ARGS.run_id,
        model_version=ARGS.model_version,
        dataset_snapshot_path=DATASET_PATH,
        dataset_hash=ARGS.dataset_hash,
        row_counts=ROW_COUNTS,
        model_type=type(model).__name__,
        vectorizer_type=type(vectorizer).__name__,
        encoder_classes=list(encoder.classes_),
        metrics=metrics,
    )

    artifact_dir = model_bundle.write_bundle(
        ARGS.model_version, model, vectorizer, encoder, metadata
    )

    print("MODEL BUNDLE SAVED SUCCESSFULLY\n")
    print("BUNDLE DIRECTORY:")
    print(artifact_dir)

    RESULT["success"] = metrics is not None
    RESULT["artifactPath"] = artifact_dir
    RESULT["metrics"] = metrics
    RESULT["encoderClasses"] = sorted(str(c) for c in encoder.classes_)
    if metrics is None:
        RESULT["error"] = RESULT["error"] or "evaluation failed; bundle saved without metrics"

except Exception as e:

    print("SAVE ERROR:", e)
    RESULT["error"] = f"bundle save error: {e}"
    _write_result_and_exit(1)

print("\nTRAINING PIPELINE COMPLETED SUCCESSFULLY")

_write_result_and_exit(0)
