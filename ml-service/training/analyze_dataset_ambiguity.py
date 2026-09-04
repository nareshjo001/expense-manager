"""
ML-001-T02 -- deduplication and label-ambiguity analysis for the merged
training dataset (usedDatasets/merged_expenses.csv).

Reports two independent things:

1. Exact-duplicate rows: identical (expenseName, expenseCategory) pairs,
   byte-for-byte on the raw CSV values. These carry zero additional
   training signal over a single copy and inflate the dataset's row
   count without inflating its information content.
2. Label ambiguity: after normalize_expense_name()'s grouping key (see
   training/category_config.py -- deliberately case-preserving, since it
   also backs production dedup/conflict-grouping keys, not just this
   analysis), how many distinct normalized descriptions map to more than
   one canonical category across the dataset. A description that
   legitimately co-occurs with two categories (e.g. "Bus ticket" logged
   as both Transport and Travel) is a real source of label noise no
   amount of more data fixes by itself.

Run from the ml-service/ directory: `python training/analyze_dataset_ambiguity.py`.
See docs/ml/ML-001-T02-deduplication-and-label-ambiguity.md for the
findings this script produced and what to do about them.
"""
import argparse
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(__file__))
from category_config import normalize_category, normalize_expense_name  # noqa: E402

DEFAULT_DATASET = os.path.join(
    os.path.dirname(__file__), "..", "usedDatasets", "merged_expenses.csv"
)


def analyze(path, case_insensitive=False):
    df = pd.read_csv(path)
    total_rows = len(df)

    exact_dupe_mask = df.duplicated(subset=["expenseName", "expenseCategory"], keep=False)
    exact_dupe_groups = df[exact_dupe_mask].groupby(["expenseName", "expenseCategory"]).size()
    exact_dupe_removable = int((exact_dupe_groups - 1).sum()) if len(exact_dupe_groups) else 0

    df["norm_name"] = df["expenseName"].apply(normalize_expense_name)
    if case_insensitive:
        df["norm_name"] = df["norm_name"].str.lower()
    df["canon_category"] = df["expenseCategory"].apply(normalize_category)

    unmapped_count = int(df["canon_category"].isna().sum())
    empty_name_count = int((df["norm_name"] == "").sum())

    usable = df[df["canon_category"].notna() & (df["norm_name"] != "")].copy()
    per_name_category_count = usable.groupby("norm_name")["canon_category"].nunique()
    ambiguous_names = per_name_category_count[per_name_category_count > 1]
    ambiguous_row_mask = usable["norm_name"].isin(ambiguous_names.index)

    return {
        "total_rows": total_rows,
        "exact_dupe_rows": int(exact_dupe_mask.sum()),
        "exact_dupe_groups": len(exact_dupe_groups),
        "exact_dupe_removable": exact_dupe_removable,
        "unmapped_category_rows": unmapped_count,
        "empty_name_rows": empty_name_count,
        "usable_rows": len(usable),
        "ambiguous_name_count": len(ambiguous_names),
        "ambiguous_row_count": int(ambiguous_row_mask.sum()),
        "ambiguous_row_pct": round(100 * ambiguous_row_mask.sum() / len(usable), 2) if len(usable) else 0,
        "usable": usable,
        "ambiguous_row_mask": ambiguous_row_mask,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", default=DEFAULT_DATASET)
    parser.add_argument("--top", type=int, default=25)
    args = parser.parse_args()

    for label, ci in (("case-preserving (production dedup-key behavior)", False), ("case-insensitive (upper bound)", True)):
        print(f"\n=== {label} ===")
        result = analyze(args.dataset, case_insensitive=ci)
        for key in (
            "total_rows", "exact_dupe_rows", "exact_dupe_groups", "exact_dupe_removable",
            "unmapped_category_rows", "empty_name_rows", "usable_rows",
            "ambiguous_name_count", "ambiguous_row_count", "ambiguous_row_pct",
        ):
            print(f"{key}: {result[key]}")

        usable, mask = result["usable"], result["ambiguous_row_mask"]
        if mask.any():
            top = (
                usable[mask]
                .groupby("norm_name")["canon_category"]
                .value_counts()
                .unstack(fill_value=0)
            )
            top["total_rows"] = top.sum(axis=1)
            top = top.sort_values("total_rows", ascending=False).head(args.top)
            print(top)


if __name__ == "__main__":
    main()
