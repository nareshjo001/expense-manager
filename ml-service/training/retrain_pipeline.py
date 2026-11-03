"""Retraining pipeline orchestration (Phase C reservation/snapshot stages, Phase D train+bundle and validate stages)."""

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
    """Executes the full Phase C + Phase D pipeline for a specific, already lock-owning `run_id`."""

    def _beat():
        if heartbeat_callback is None:
            return
        try:
            heartbeat_callback()
        except Exception:
            pass

    def _stage_done(stage_name):
        """Fired once per completed stage ("reservation", "snapshot", "training", "validation"), separate from the plain liveness heartbeat above."""
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
