import os
import pandas as pd

# PATH SETUP
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

# LOAD DATASETS
base_df = pd.read_csv(BASE_DATASET_PATH)
feedback_df = pd.read_csv(FEEDBACK_DATASET_PATH)

# MERGE DATASETS
merged_df = pd.concat(
    [base_df, feedback_df],
    ignore_index=True
)

# SAVE MERGED DATASET
merged_df.to_csv(
    RETRAIN_DATASET_PATH,
    index=False
)

print(
    "Datasets merged and saved to dataset/retrain_data.csv"
)

print(len(base_df), "->", len(merged_df), "records after merging")