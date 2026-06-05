import os
import sys
import subprocess

CURRENT_DIR = os.path.dirname(
    os.path.abspath(__file__)
)

EXPORT_SCRIPT = os.path.join(
    CURRENT_DIR,
    "export_feedback.py"
)

MERGE_SCRIPT = os.path.join(
    CURRENT_DIR,
    "feedback",
    "merge_datasets.py"
)

TRAIN_SCRIPT = os.path.join(
    CURRENT_DIR,
    "trainer.py"
)

PYTHON_PATH = sys.executable


def run_python_script(script_path):

    result = subprocess.run(
        [PYTHON_PATH, script_path],
        capture_output=True,
        text=True
    )

    if result.stdout:
        print(result.stdout)

    if result.stderr:
        print(result.stderr)

    if result.returncode != 0:
        raise Exception(
            f"Script failed: {script_path}"
        )

    return result


def run_retraining():

    try:

        print("\nSTEP 1 — EXPORTING FEEDBACK\n")

        run_python_script(
            EXPORT_SCRIPT
        )

        print("\nSTEP 2 — MERGING DATASETS\n")

        run_python_script(
            MERGE_SCRIPT
        )

        print("\nSTEP 3 — RETRAINING MODEL\n")

        run_python_script(
            TRAIN_SCRIPT
        )

        print("\nRETRAINING COMPLETE\n")

        return {
            "success": True,
            "message": "Retraining completed successfully"
        }

    except Exception as e:

        print(
            f"Retraining failed: {str(e)}"
        )

        return {
            "success": False,
            "error": str(e)
        }


if __name__ == "__main__":

    result = run_retraining()

    print(result)