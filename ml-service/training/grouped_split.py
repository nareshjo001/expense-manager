"""
ML-001-T03 -- grouped train/validation/test splitting.

ML-001-T02's dataset audit (docs/ml/ML-001-T02-deduplication-and-label-
ambiguity.md) found that 77% of the training dataset's rows are exact
duplicates of some other row's (expenseName, expenseCategory) pair --
only 11,514 of 97,056 rows are actually distinct examples. trainer.py's
previous split (plain sklearn.model_selection.train_test_split,
stratified by label only) had no way to know that, so a duplicate could
land in both train and test: the model would then be "tested" on an
example it had already memorized verbatim during training, inflating
the reported accuracy without the model actually generalizing any
better.

This module fixes that at the split level: every row is assigned a
group key (its post-cleaning expenseName, joined with its normalized
category -- the same text the model actually trains on, not the raw
input), and no group is ever allowed to appear in more than one of
train/validation/test. That is the actual guarantee this module exists
to provide; grouped_train_val_test_split()'s docstring and
assert_no_group_leakage() both exist to make that guarantee checkable,
not just assumed.

Splitting is stratified by label where feasible (StratifiedGroupKFold),
falling back to group-only splitting (GroupShuffleSplit, no
stratification) if a class doesn't have enough distinct groups to
stratify, and finally to today's un-grouped stratified split as a last
resort if even that fails -- each fallback is recorded in the returned
`strategy` string rather than happening silently, mirroring the
fallback_split_used flag trainer.py already reports for its label-only
stratification fallback.
"""

import numpy as np
from sklearn.model_selection import (
    GroupShuffleSplit,
    StratifiedGroupKFold,
    train_test_split,
)

# 1/TEST_FOLDS ~= 20% of the full dataset held out as test.
DEFAULT_TEST_FOLDS = 5
# 1/VAL_FOLDS of the REMAINING (train+val) portion after test is held out
# -- with TEST_FOLDS=5 and VAL_FOLDS=8, that's 1/8 of 80% = 10% of the
# full dataset, leaving ~70% for training.
DEFAULT_VAL_FOLDS = 8

STRATEGY_STRATIFIED_GROUP = "stratified_group"
STRATEGY_GROUP_ONLY = "group_only"
STRATEGY_UNGROUPED_STRATIFIED = "ungrouped_stratified"
STRATEGY_UNGROUPED_PLAIN = "ungrouped_plain"


def make_group_key(clean_names, normalized_categories):
    """
    Builds the group key array used for splitting: the post-cleaning
    expense name (what TF-IDF actually vectorizes) joined with the
    normalized category. Two array-likes in, one numpy string array out,
    same length and order -- callers pass this straight to
    grouped_train_val_test_split's `groups` argument.
    """
    clean_names = np.asarray(clean_names, dtype=str)
    normalized_categories = np.asarray(normalized_categories, dtype=str)
    if clean_names.shape[0] != normalized_categories.shape[0]:
        raise ValueError(
            f"make_group_key: length mismatch ({clean_names.shape[0]} names vs "
            f"{normalized_categories.shape[0]} categories)"
        )
    return np.char.add(np.char.add(clean_names, "||"), normalized_categories)


def _stratified_group_split(n_samples, y, groups, test_folds, val_folds, random_state):
    indices = np.arange(n_samples)
    sgkf_test = StratifiedGroupKFold(n_splits=test_folds, shuffle=True, random_state=random_state)
    trainval_idx, test_idx = next(sgkf_test.split(indices, y, groups))

    sgkf_val = StratifiedGroupKFold(n_splits=val_folds, shuffle=True, random_state=random_state)
    train_sub, val_sub = next(
        sgkf_val.split(trainval_idx, y[trainval_idx], groups[trainval_idx])
    )
    return trainval_idx[train_sub], trainval_idx[val_sub], test_idx


def _group_only_split(n_samples, y, groups, test_folds, val_folds, random_state):
    indices = np.arange(n_samples)
    gss_test = GroupShuffleSplit(n_splits=1, test_size=1.0 / test_folds, random_state=random_state)
    trainval_idx, test_idx = next(gss_test.split(indices, y, groups))

    gss_val = GroupShuffleSplit(n_splits=1, test_size=1.0 / val_folds, random_state=random_state)
    train_sub, val_sub = next(
        gss_val.split(trainval_idx, y[trainval_idx], groups[trainval_idx])
    )
    return trainval_idx[train_sub], trainval_idx[val_sub], test_idx


def _ungrouped_split(n_samples, y, test_folds, val_folds, random_state):
    indices = np.arange(n_samples)
    try:
        trainval_idx, test_idx = train_test_split(
            indices, test_size=1.0 / test_folds, random_state=random_state, stratify=y
        )
        stratified = True
    except ValueError:
        trainval_idx, test_idx = train_test_split(
            indices, test_size=1.0 / test_folds, random_state=random_state
        )
        stratified = False

    try:
        train_idx, val_idx = train_test_split(
            trainval_idx,
            test_size=1.0 / val_folds,
            random_state=random_state,
            stratify=y[trainval_idx] if stratified else None,
        )
    except ValueError:
        train_idx, val_idx = train_test_split(
            trainval_idx, test_size=1.0 / val_folds, random_state=random_state
        )
        stratified = False

    return train_idx, val_idx, test_idx, (
        STRATEGY_UNGROUPED_STRATIFIED if stratified else STRATEGY_UNGROUPED_PLAIN
    )


def grouped_train_val_test_split(
    y,
    groups,
    test_folds=DEFAULT_TEST_FOLDS,
    val_folds=DEFAULT_VAL_FOLDS,
    random_state=42,
):
    """
    Splits len(y) samples into (train_idx, val_idx, test_idx, strategy),
    each an integer numpy index array into range(len(y)), with no group
    value shared across more than one of the three -- guaranteed for
    "stratified_group" and "group_only" strategies; NOT guaranteed for
    the ungrouped fallback strategies, which only run when grouping
    itself proved infeasible (see module docstring). Callers that need
    the guarantee checked, not just assumed, should call
    assert_no_group_leakage() on the result.

    y and groups must be numpy arrays (or array-likes) of the same
    length as each other, in the same row order as whatever feature
    matrix the caller will index with the returned indices.
    """
    y = np.asarray(y)
    groups = np.asarray(groups)
    n_samples = len(y)
    if len(groups) != n_samples:
        raise ValueError(
            f"grouped_train_val_test_split: y has {n_samples} rows but groups has {len(groups)}"
        )

    try:
        train_idx, val_idx, test_idx = _stratified_group_split(
            n_samples, y, groups, test_folds, val_folds, random_state
        )
        return train_idx, val_idx, test_idx, STRATEGY_STRATIFIED_GROUP
    except ValueError:
        pass

    try:
        train_idx, val_idx, test_idx = _group_only_split(
            n_samples, y, groups, test_folds, val_folds, random_state
        )
        return train_idx, val_idx, test_idx, STRATEGY_GROUP_ONLY
    except ValueError:
        pass

    return _ungrouped_split(n_samples, y, test_folds, val_folds, random_state)


def assert_no_group_leakage(groups, train_idx, val_idx, test_idx, sample_limit=10):
    """
    Raises AssertionError (naming which split pairs overlap and how many
    groups, plus a small sample) if any group appears in more than one
    of the three splits. Silent (returns None) when clean.
    """
    groups = np.asarray(groups)
    g_train = set(groups[train_idx])
    g_val = set(groups[val_idx])
    g_test = set(groups[test_idx])

    overlaps = {
        "train/val": g_train & g_val,
        "train/test": g_train & g_test,
        "val/test": g_val & g_test,
    }
    leaking = {pair: groups_ for pair, groups_ in overlaps.items() if groups_}
    if leaking:
        details = ", ".join(
            f"{pair}: {len(groups_)} shared group(s), e.g. {sorted(groups_)[:sample_limit]}"
            for pair, groups_ in leaking.items()
        )
        raise AssertionError(f"group leakage detected -- {details}")
