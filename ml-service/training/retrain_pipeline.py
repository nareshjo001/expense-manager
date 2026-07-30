"""
Retraining pipeline orchestration (Phase C reservation/snapshot stages,
Phase D train+bundle and validate stages).

Sequence:
  1. reserve currently-pending feedback for this run
     (training/dataset_builder.py -> db/feedback_repository.py)
  2. build the cumulative, immutable, run-specific dataset snapshot
     (training/dataset_builder.py)
  3. invoke trainer.py as a subprocess against that exact snapshot path --
     trains, evaluates, and writes an immutable versioned candidate bundle
     (training/model_bundle.py), reporting back a structured result via a
     result-file (Phase D)
  4. invoke validate_model.py as a subprocess against that candidate bundle
     -- runs the 9 named validation gates (training/model_validation.py),
     reporting back a structured result via a result-file (Phase D)

A heartbeat fires after each of these four stages so a caller tracking a
persistent training-run record can see progress without needing to poll any
more deeply than "still alive" (see db/training_run_repository.py).

This module intentionally does NOT import db.training_run_repository or
mutate any training-run document itself -- it stays a pure orchestrator that
returns a structured result dict. app.py's background_retrain is the only
place that writes to the run record, matching the existing Phase B
convention. In particular, this module has no MongoDB access at all: the
previous-run baseline (previous_accuracy / previous_categories) is fetched
by app.py BEFORE calling run_retraining and passed in as plain arguments,
since only app.py has a database connection.

Note: training/export_feedback.py and training/feedback/merge_datasets.py
are superseded by training/dataset_builder.py as of Phase C and are no
longer invoked by this pipeline -- see their own module docstrings.

Note: this module does NOT decide model versions itself -- it asks
training/model_bundle.py (model_bundle.model_version_for_run(run_id)) for
the version, so trainer.py, validate_model.py, and any future
Phase E loader all agree on the same version string for a given run without
this module needing to pass it around as an opaque string decided
elsewhere.
"""

import os
import sys
import json
import tempfile
import subprocess

from training import dataset_builder
from training import model_bundle

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
TRAIN_SCRIPT = os.path.join(CURRENT_DIR, "trainer.py")
VALIDATE_SCRIPT = os.path.join(CURRENT_DIR, "validate_model.py")
PYTHON_PATH = sys.executable


def _run_subprocess(args, label):
    result = subprocess.run(
        args,
        capture_output=True,
        text=True
    )

    if result.stdout:
        print(result.stdout)

    if result.stderr:
        print(result.stderr)

    if result.returncode != 0:
        raise Exception(
            f"{label} failed (exit code {result.returncode})"
        )

    return result


def _read_result_file(path, label):
    if not os.path.isfile(path):
        raise Exception(f"{label} did not produce a result file at {path}")
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _run_trainer(run_id, model_version, dataset_path, dataset_hash, row_counts, previous_accuracy):
    fd, result_path = tempfile.mkstemp(prefix=f"train-result-{run_id}-", suffix=".json")
    os.close(fd)
    try:
        args = [
            PYTHON_PATH, TRAIN_SCRIPT,
            "--dataset", dataset_path,
            "--run-id", str(run_id),
            "--model-version", model_version,
            "--dataset-hash", dataset_hash,
            "--row-counts-json", json.dumps(row_counts),
            "--result-path", result_path,
        ]
        if previous_accuracy is not None:
            args += ["--previous-accuracy", str(previous_accuracy)]

        _run_subprocess(args, "trainer.py")
        return _read_result_file(result_path, "trainer.py")
    finally:
        try:
            if os.path.isfile(result_path):
                os.remove(result_path)
        except Exception:
            pass


def _run_validator(run_id, model_version, dataset_hash, row_counts, previous_accuracy, previous_categories):
    fd, result_path = tempfile.mkstemp(prefix=f"validate-result-{run_id}-", suffix=".json")
    os.close(fd)
    try:
        args = [
            PYTHON_PATH, VALIDATE_SCRIPT,
            "--model-version", model_version,
            "--dataset-hash", dataset_hash,
            "--row-counts-json", json.dumps(row_counts),
            "--result-path", result_path,
        ]
        if previous_accuracy is not None:
            args += ["--previous-accuracy", str(previous_accuracy)]
        if previous_categories is not None:
            args += ["--previous-categories-json", json.dumps(previous_categories)]

        # A non-zero exit means validation could not run at all (an ordinary gate failure still exits 0).
        _run_subprocess(args, "validate_model.py")
        return _read_result_file(result_path, "validate_model.py")
    finally:
        try:
            if os.path.isfile(result_path):
                os.remove(result_path)
        except Exception:
            pass


def run_retraining(run_id, previous_accuracy=None, previous_categories=None,
                    heartbeat_callback=None, stage_callback=None):
    """
    Executes the full Phase C + Phase D pipeline for a specific, already
    lock-owning `run_id`.

    `previous_accuracy` / `previous_categories` describe the most recent
    COMPLETED training run's baseline, as fetched by app.py via
    db.training_run_repository.get_latest_completed_run BEFORE this
    function is called. Both are None when no such run exists yet (first
    run) -- this function never invents a baseline; it simply forwards
    whatever it was given down to validate_model.py, which is the only
    place the actual regression/category-set comparisons happen (Gates 7
    and 9).

    `stage_callback`, if given, is invoked with a single stage-name string
    ("reservation", "snapshot", "training", "validation") once each stage
    completes successfully -- separate from `heartbeat_callback`, which
    fires at the same points but takes no arguments. app.py uses
    stage_callback specifically to call db.training_run_repository
    .mark_evaluating() the instant the "training" stage finishes, since
    this module has no MongoDB access of its own.

    Returns a structured result dict. On success:

        {
            "success": True,
            "message": "...",
            "reservedFeedbackIds": [...],
            "datasetMetadata": {...},
            "modelVersion": "model-<runId>",
            "artifactPath": "...",
            "metrics": {...},
            "encoderClasses": [...],
            "validation": {"success": True, "gates": [...]},
        }

    On failure at any stage:

        {
            "success": False,
            "stage": "reservation" | "snapshot" | "training" | "validation",
            "error": "...",
            "reservedFeedbackIds": [...],
            "datasetMetadata": {...} or None,
            "modelVersion": "..." or None,
            "artifactPath": "..." or None,
            "metrics": {...} or None,
            "encoderClasses": [...] or None,
            "validation": {...} or None,
        }

    This function does not itself decide what happens to reserved feedback
    on failure -- that is app.py's background_retrain, via
    db.feedback_repository.release_reserved_for_run. It also does not
    decide what happens to the candidate bundle on validation failure --
    Phase D's explicit instruction is that old/failed bundles are NOT
    deleted in this phase (see model_bundle.write_bundle's docstring); the
    bundle is simply left on disk, unreferenced by any "active" pointer.
    """

    def _beat():
        if heartbeat_callback is None:
            return
        try:
            heartbeat_callback()
        except Exception:
            pass

    def _stage_done(stage_name):
        """
        Fired once per completed stage ("reservation", "snapshot",
        "training", "validation"), separate from the plain liveness
        heartbeat above. app.py uses this specifically to transition the
        run's persisted status to "evaluating" right after the "training"
        stage finishes (i.e. the exact moment a candidate bundle exists but
        has not yet been validated) -- this module has no MongoDB access
        itself, so it cannot make that status change directly.
        """
        if stage_callback is None:
            return
        try:
            stage_callback(stage_name)
        except Exception:
            pass

    reserved_feedback_ids = []
    model_version = model_bundle.model_version_for_run(run_id)

    def _failure(stage, error, dataset_metadata=None, artifact_path=None,
                 metrics=None, encoder_classes=None, validation=None):
        return {
            "success": False,
            "stage": stage,
            "error": error,
            "reservedFeedbackIds": reserved_feedback_ids,
            "datasetMetadata": dataset_metadata,
            "modelVersion": model_version,
            "artifactPath": artifact_path,
            "metrics": metrics,
            "encoderClasses": encoder_classes,
            "validation": validation,
        }

    try:
        print("\nSTEP 1 — RESERVING FEEDBACK\n")
        reservation = dataset_builder.reserve_feedback_for_run(run_id)
        reserved_feedback_ids = [str(doc["_id"]) for doc in reservation]
        print(f"Reserved {len(reservation)} pending feedback document(s) for run {run_id}")
        _beat()
        _stage_done("reservation")
    except Exception as e:
        print(f"Reservation failed: {e}")
        return _failure("reservation", str(e))

    try:
        print("\nSTEP 2 — BUILDING DATASET SNAPSHOT\n")
        snapshot = dataset_builder.build_snapshot_for_run(run_id, reservation)
        print(f"Snapshot written to {snapshot['path']} (sha256={snapshot['sha256'][:12]}...)")
        print(f"Row counts: {snapshot['rowCounts']}")
        _beat()
        _stage_done("snapshot")
    except Exception as e:
        print(f"Snapshot construction failed: {e}")
        return _failure("snapshot", str(e))

    try:
        print("\nSTEP 3 — TRAINING MODEL AND WRITING CANDIDATE BUNDLE\n")
        train_result = _run_trainer(
            run_id=run_id,
            model_version=model_version,
            dataset_path=snapshot["path"],
            dataset_hash=snapshot["sha256"],
            row_counts=snapshot["rowCounts"],
            previous_accuracy=previous_accuracy,
        )
        if not train_result.get("success"):
            raise Exception(train_result.get("error") or "trainer.py reported failure")

        artifact_path = train_result.get("artifactPath")
        metrics = train_result.get("metrics")
        encoder_classes = train_result.get("encoderClasses")
        print(f"Candidate bundle written to {artifact_path}")
        _beat()
        _stage_done("training")
    except Exception as e:
        print(f"Training failed: {e}")
        return _failure("training", str(e), dataset_metadata=snapshot)

    try:
        print("\nSTEP 4 — VALIDATING CANDIDATE BUNDLE\n")
        validation = _run_validator(
            run_id=run_id,
            model_version=model_version,
            dataset_hash=snapshot["sha256"],
            row_counts=snapshot["rowCounts"],
            previous_accuracy=previous_accuracy,
            previous_categories=previous_categories,
        )
        print(f"Validation result: success={validation.get('success')}")
        _beat()
        _stage_done("validation")
    except Exception as e:
        print(f"Validation could not be run: {e}")
        return _failure(
            "validation", str(e), dataset_metadata=snapshot,
            artifact_path=artifact_path, metrics=metrics,
            encoder_classes=encoder_classes,
        )

    if not validation.get("success"):
        failed_gate = next(
            (g["gate"] for g in validation.get("gates", [])
             if not g.get("passed") and not g.get("skipped")),
            None
        )
        error_message = (
            validation.get("error")
            or (f"validation gate '{failed_gate}' failed" if failed_gate else "validation failed")
        )
        print(f"Validation failed: {error_message}")
        return _failure(
            "validation", error_message, dataset_metadata=snapshot,
            artifact_path=artifact_path, metrics=metrics,
            encoder_classes=encoder_classes, validation=validation,
        )

    print("\nRETRAINING AND VALIDATION COMPLETE\n")

    return {
        "success": True,
        "message": "Retraining and validation completed successfully",
        "reservedFeedbackIds": reserved_feedback_ids,
        "datasetMetadata": snapshot,
        "modelVersion": model_version,
        "artifactPath": artifact_path,
        "metrics": metrics,
        "encoderClasses": encoder_classes,
        "validation": validation,
    }


if __name__ == "__main__":
    print(
        "run_retraining(run_id, ...) now requires a persistent training-run "
        "id (see db/training_run_repository.py) and reserves real MongoDB "
        "feedback as a side effect -- it is meant to be invoked from "
        "app.py's background_retrain, not run standalone without a run_id."
    )
