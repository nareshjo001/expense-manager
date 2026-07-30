# Superseded by training/dataset_builder.py's build_snapshot_for_run; kept for reference, not read by trainer.py.

import os
import pandas as pd

CURRENT_DIR = os.path.dirname(
    os.path.abspath(__file__)
)

BASE_DATASET_PATH = os.path.join(
    CURRENT_DIR,
    "..",
    "dataset",
    "merged_expenses.csv"
)

FEEDBACK_DATASET_PATH = os.path.join(
    CURRENT_DIR,
    "..",
    "dataset",
    "feedback_data.csv"
)

RETRAIN_DATASET_PATH = os.path.join(
    CURRENT_DIR,
    "..",
    "dataset",
    "retrain_data.csv"
)

if os.path.exists(FEEDBACK_DATASET_PATH):
    print(
        "Feedback file size:",
        os.path.getsize(FEEDBACK_DATASET_PATH)
    )

base_df = pd.read_csv(BASE_DATASET_PATH)
feedback_df = pd.read_csv(FEEDBACK_DATASET_PATH)

merged_df = pd.concat(
    [base_df, feedback_df],
    ignore_index=True
)

merged_df.to_csv(
    RETRAIN_DATASET_PATH,
    index=False
)

print(len(base_df), "->", len(merged_df), "records after merging")