"""Define the coverage/quality abstention threshold policy that T03 (abstention flag in the API contract) will read from."""
import argparse
import datetime
import json
import os

import category_config

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_CALIBRATION_REPORT_PATH = os.path.join(BASE_DIR, "calibration_report.json")
DEFAULT_POLICY_PATH = os.path.join(BASE_DIR, "threshold_policy.json")

SCHEMA_VERSION = 1

# 0]) -- see this module's docstring for why a cluster boundary, not a fitted per-class precision curve, is the trustworthy part of that report under the stated data-contamination caveat.
GLOBAL_DEFAULT_THRESHOLD = 0.90

# Below this, treat the report as too stale/foreign to build a policy
# from without a human re-checking the reasoning above still applies.
SUPPORTED_CALIBRATION_TASK = "ML-003-T01"


def _coverage_at_threshold(per_class_report, threshold):
    """Py's per-class `curve` field -- no re-scoring of the model, just re-aggregating numbers it already produced."""
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
        # Classes whose committed share falls noticeably below the overall average at this threshold -- worth a human's eye once real per-class thresholds are derived, not actioned here.
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
