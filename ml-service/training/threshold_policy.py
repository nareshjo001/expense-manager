"""
ML-003-T02 -- define the coverage/quality abstention threshold policy that
T03 (abstention flag in the API contract) will read from.

WHAT "COVERAGE" AND "QUALITY" MEAN HERE, PRECISELY

For a given confidence threshold t: a prediction is COMMITTED if
confidence >= t, and ABSTAINED otherwise (T03's job is to turn that
boolean into an actual API field; this module only decides t).
  - QUALITY of a class at t = precision among that class's COMMITTED
    predictions only (abstained ones are excluded, not counted as wrong).
  - COVERAGE of a class at t = committed / total predictions of that
    class -- how much of the traffic a threshold still lets through
    without asking the model to abstain.
These reuse calibrate_confidence.py's own per-class `curve`/`coverage`/
`precision` fields (ML-003-T01) rather than redefining the metric a
second time.

WHY THIS IS A SINGLE GLOBAL THRESHOLD, NOT 15 PER-CLASS ONES

ML-003-T01's own methodology caveat (see calibration_report.json's
"methodologyCaveat" and docs/ml/ML-003-T01-confidence-calibration.md)
found that EVERY one of the 15 canonical categories clears every
precision target (p80/p90/p95) at the lowest grid threshold tested
(0.30), because the validation fold is drawn from a ~85% templated/
synthetic, 77%-exact-duplicate dataset -- the model is largely being
re-asked questions it has already memorized. Under that condition, the
PER-CLASS differences in the calibration curve are more likely artifacts
of which synthetic generator produced more or fewer near-duplicate
templates for a given category than genuine differences in how hard
that category actually is to classify. Committing to 15 distinct
numbers today would encode dataset contamination as if it were product
policy -- exactly what T01 warned T02 not to do.

What the data DOES support, even under that caveat, is a coarser,
distribution-level signal: calibration_report.json's confidence-bin
histogram shows 98.7% of the validation fold landing in the [0.9, 1.0]
confidence bin. That is not a fine-grained precision estimate -- it is
where this specific model's own output happens to cluster. A prediction
scoring below that cluster is already an outlier for this model,
regardless of whether the cluster's OWN accuracy number can be trusted.
That qualitative cliff is the one thing about this curve robust to the
contamination problem, so it is what this policy is built on: a single,
conservative GLOBAL_DEFAULT_THRESHOLD at the edge of that cluster,
applied identically to every category until real thresholds can be
derived per class.

WHEN THIS BECOMES A REAL PER-CLASS POLICY

Two conditions, either sufficient on its own once genuinely met:
  1. The served model is retrained through the versioned pipeline
     (training/model_bundle.py's manifest), proving real train/val
     disjointness -- today's legacy bundle predates that system and
     carries no recorded manifest (T01's finding #1).
  2. Enough real, non-synthetic feedback accumulates in
     db/feedback_repository.py that calibrate_confidence.py can be
     re-run against genuinely novel input the model has not memorized
     any template of (T01's finding #2 -- the one condition #1 alone
     does not fix, since a manifested retrain on the SAME templated
     CSV would still be optimistic).
Re-running calibrate_confidence.py under either condition and feeding
its fresh calibration_report.json back into build_policy() below is the
intended upgrade path -- perClassThresholds only needs to stop being
None per category once that evidence exists; nothing else in this
module's schema needs to change.

WHAT THIS SCRIPT DOES NOT DO

It does not retrain anything, does not touch predictor.py or the live
serving path, and does not require a database connection -- it is a
pure, offline transform of an existing calibration_report.json into a
policy artifact. Wiring GLOBAL_DEFAULT_THRESHOLD into an actual abstain
decision in the API response is T03, not this task.

Run from the ml-service/ directory: `python training/threshold_policy.py`
"""
import argparse
import datetime
import json
import os

import category_config

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CALIBRATION_REPORT_PATH = os.path.join(BASE_DIR, "calibration_report.json")
DEFAULT_POLICY_PATH = os.path.join(BASE_DIR, "threshold_policy.json")

SCHEMA_VERSION = 1

# The edge of the confidence cluster calibrate_confidence.py's bin
# histogram found (98.7% of the validation fold in [0.9, 1.0]) -- see
# this module's docstring for why a cluster boundary, not a fitted
# per-class precision curve, is the trustworthy part of that report
# under the stated data-contamination caveat.
GLOBAL_DEFAULT_THRESHOLD = 0.90

# Below this, treat the report as too stale/foreign to build a policy
# from without a human re-checking the reasoning above still applies.
SUPPORTED_CALIBRATION_TASK = "ML-003-T01"


def _coverage_at_threshold(per_class_report, threshold):
    """
    Overall (support-weighted across all 15 classes) coverage and
    precision-among-committed at a candidate global threshold, read
    directly off calibrate_confidence.py's per-class `curve` field --
    no re-scoring of the model, just re-aggregating numbers it already
    produced.
    """
    total_predicted = 0
    total_committed = 0
    total_correct_committed = 0.0
    per_class_flags = []

    for cls, entry in per_class_report.items():
        predicted_count = entry.get("predictedCount") or 0
        total_predicted += predicted_count
        if predicted_count == 0:
            continue

        point = next(
            (c for c in entry["curve"] if abs(c["threshold"] - threshold) < 1e-6),
            None,
        )
        if point is None or point["precision"] is None:
            continue

        total_committed += point["coverage"]
        total_correct_committed += point["coverage"] * point["precision"]

        class_coverage_frac = point["coverage"] / predicted_count
        if class_coverage_frac < 0.95:
            per_class_flags.append({
                "class": cls,
                "coverageFraction": round(class_coverage_frac, 4),
                "precisionAmongCommitted": point["precision"],
            })

    overall_coverage_frac = (total_committed / total_predicted) if total_predicted else None
    overall_precision = (total_correct_committed / total_committed) if total_committed else None

    return {
        "threshold": threshold,
        "overallCoverageFraction": round(overall_coverage_frac, 4) if overall_coverage_frac is not None else None,
        "overallPrecisionAmongCommitted": round(overall_precision, 4) if overall_precision is not None else None,
        "totalPredicted": total_predicted,
        "totalCommitted": total_committed,
        # Classes whose committed share falls noticeably below the
        # overall average at this threshold -- worth a human's eye
        # once real per-class thresholds are derived, not actioned here.
        "belowAverageCoverageClasses": per_class_flags,
    }


def build_policy(calibration_report, global_threshold=GLOBAL_DEFAULT_THRESHOLD):
    if calibration_report.get("task") != SUPPORTED_CALIBRATION_TASK:
        raise ValueError(
            f"calibration_report.json's 'task' field is "
            f"{calibration_report.get('task')!r}, expected "
            f"{SUPPORTED_CALIBRATION_TASK!r} -- re-check this module's "
            f"reasoning still applies before building a policy from a "
            f"differently-sourced report."
        )

    per_class_report = calibration_report["perClass"]
    candidate_thresholds = [0.80, 0.85, 0.90, 0.95]
    coverage_by_candidate = [
        _coverage_at_threshold(per_class_report, t) for t in candidate_thresholds
    ]

    policy = {
        "schemaVersion": SCHEMA_VERSION,
        "task": "ML-003-T02",
        "trustLevel": "synthetic-provisional",
        "basedOn": {
            "calibrationTask": calibration_report.get("task"),
            "calibrationReportPath": "ml-service/training/calibration_report.json",
            "methodologyCaveatCarriedForward": calibration_report.get("methodologyCaveat"),
        },
        "metricDefinitions": {
            "quality": "Precision among a class's COMMITTED (non-abstained) predictions only.",
            "coverage": "Fraction of a class's predictions that are committed (confidence >= threshold) rather than abstained.",
        },
        "qualityTargets": calibration_report.get("precisionTargets", [0.80, 0.90, 0.95]),
        # Deliberately flat: one number for all 15 canonical categories.
        # See this module's docstring for why per-class values are not
        # set yet. `perClassThresholds` stays None per category as an
        # explicit, visible placeholder for T03 -- not a silent gap.
        "globalDefaultThreshold": global_threshold,
        "perClassThresholds": {cls: None for cls in category_config.CANONICAL_CATEGORIES},
        "coverageAtCandidateThresholds": coverage_by_candidate,
        "revisitTrigger": (
            "Re-run training/calibrate_confidence.py and training/threshold_policy.py "
            "once EITHER: (1) the served model has been retrained through the versioned "
            "pipeline (training/model_bundle.py manifest), proving real train/val "
            "disjointness for the legacy bundle's successor, OR (2) enough real, "
            "non-synthetic rows have accumulated in db/feedback_repository.py to "
            "re-score confidence against input the model has not memorized a template "
            "of. Populate perClassThresholds[<category>] with a real value only once "
            "that re-run's own report supports it for that specific category."
        ),
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    return policy


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--calibration-report", default=DEFAULT_CALIBRATION_REPORT_PATH)
    parser.add_argument("--policy-path", default=DEFAULT_POLICY_PATH)
    parser.add_argument("--global-threshold", type=float, default=GLOBAL_DEFAULT_THRESHOLD)
    args = parser.parse_args()

    with open(args.calibration_report, "r", encoding="utf-8") as fh:
        calibration_report = json.load(fh)

    policy = build_policy(calibration_report, global_threshold=args.global_threshold)

    print(f"Global default threshold: {policy['globalDefaultThreshold']}")
    print(f"\nCoverage/quality at candidate global thresholds (support-weighted, all 15 classes):")
    print(f"  {'threshold':>9} {'coverage':>10} {'precision':>10}  flagged-low-coverage-classes")
    for point in policy["coverageAtCandidateThresholds"]:
        flagged = ", ".join(f["class"] for f in point["belowAverageCoverageClasses"]) or "--"
        print(
            f"  {point['threshold']:>9.2f} {point['overallCoverageFraction']:>10.4f} "
            f"{point['overallPrecisionAmongCommitted']:>10.4f}  {flagged}"
        )

    with open(args.policy_path, "w", encoding="utf-8") as fh:
        json.dump(policy, fh, indent=2)
    print(f"\nPolicy written to {args.policy_path}")


if __name__ == "__main__":
    main()
