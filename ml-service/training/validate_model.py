"""Run_all_gates. py's own process, which would collapse those two heartbeat points into one."""

import os
import sys
import json
import argparse

import model_validation


def _resolve_max_regression(cli_value):
    """ML_MAX_ACCURACY_REGRESSION must be configurable, never hardcoded."""
    if cli_value is not None:
        return float(cli_value)

    env_value = os.getenv("ML_MAX_ACCURACY_REGRESSION")
    if env_value is not None and env_value.strip() != "":
        return float(env_value)

    return 0.05


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-version", required=True)
    parser.add_argument("--dataset-hash", required=True)
    parser.add_argument("--row-counts-json", required=True)
    parser.add_argument("--result-path", required=True)
    parser.add_argument("--previous-accuracy", default=None)
    parser.add_argument("--previous-categories-json", default=None)
    parser.add_argument("--max-regression", default=None)
    args = parser.parse_args()

    try:
        row_counts = json.loads(args.row_counts_json)
    except json.JSONDecodeError as exc:
        sys.stderr.write(f"invalid --row-counts-json: {exc}\n")
        sys.exit(1)

    previous_accuracy = (
        float(args.previous_accuracy) if args.previous_accuracy is not None else None
    )

    previous_categories = None
    if args.previous_categories_json is not None:
        try:
            previous_categories = json.loads(args.previous_categories_json)
        except json.JSONDecodeError as exc:
            sys.stderr.write(f"invalid --previous-categories-json: {exc}\n")
            sys.exit(1)

    try:
        max_regression = _resolve_max_regression(args.max_regression)
    except ValueError as exc:
        sys.stderr.write(f"invalid max-regression value: {exc}\n")
        sys.exit(1)

    result = {"success": False, "gates": [], "error": None}

    try:
        overall_passed, gate_results = model_validation.run_all_gates(
            model_version=args.model_version,
            expected_dataset_hash=args.dataset_hash,
            expected_row_counts=row_counts,
            previous_accuracy=previous_accuracy,
            previous_categories=previous_categories,
            max_regression=max_regression,
        )
        result["success"] = overall_passed
        result["gates"] = gate_results
    except Exception as exc:
        # Distinguishes "validator crashed" from an ordinary gate failure, which run_all_gates reports as a structured result, not an exception.
        result["success"] = False
        result["error"] = f"{type(exc).__name__}: {exc}"

    try:
        with open(args.result_path, "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=2)
    except Exception as exc:
        sys.stderr.write(f"failed to write result file: {exc}\n")
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
