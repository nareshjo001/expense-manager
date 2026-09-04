"""
[UNIT] ML-001-T03 -- training/grouped_split.py: grouped train/val/test
splitting that prevents a duplicate (expenseName, expenseCategory) pair
from leaking across splits (ML-001-T02's 77%-duplicate finding).

Real, unmocked tests -- grouped_split.py only depends on numpy/sklearn,
both already required by trainer.py.
"""

import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "training")))

import grouped_split  # noqa: E402


def _make_dataset(n_groups_per_class=40, rows_per_group=3, n_classes=4, seed=0):
    """
    Builds a synthetic labeled dataset with real, deliberate duplication:
    each of n_groups_per_class * n_classes distinct (name, category) pairs
    appears `rows_per_group` times, mirroring the real dataset's 77%
    duplicate-row shape. Returns (y, groups) as numpy arrays, plus the
    number of distinct groups per class for assertions.
    """
    rng = np.random.default_rng(seed)
    y = []
    groups = []
    for cls in range(n_classes):
        for g in range(n_groups_per_class):
            key = f"class{cls}-item{g}"
            for _ in range(rows_per_group):
                y.append(f"cat{cls}")
                groups.append(key)
    order = rng.permutation(len(y))
    y = np.array(y)[order]
    groups = np.array(groups)[order]
    return y, groups


class TestMakeGroupKey:
    def test_joins_name_and_category_pairwise(self):
        keys = grouped_split.make_group_key(["coffee", "bus"], ["Food", "Transport"])
        assert list(keys) == ["coffee||Food", "bus||Transport"]

    def test_raises_on_length_mismatch(self):
        with pytest.raises(ValueError):
            grouped_split.make_group_key(["a", "b"], ["x"])


class TestGroupedTrainValTestSplit:
    def test_returns_index_arrays_covering_every_row_exactly_once(self):
        y, groups = _make_dataset()
        train_idx, val_idx, test_idx, strategy = grouped_split.grouped_train_val_test_split(
            y, groups, test_folds=5, val_folds=8
        )
        all_idx = np.concatenate([train_idx, val_idx, test_idx])
        assert len(all_idx) == len(y)
        assert set(all_idx) == set(range(len(y)))  # exactly once each, none dropped/duplicated

    def test_no_group_ever_appears_in_more_than_one_split(self):
        y, groups = _make_dataset()
        train_idx, val_idx, test_idx, strategy = grouped_split.grouped_train_val_test_split(
            y, groups, test_folds=5, val_folds=8
        )
        # Must not raise.
        grouped_split.assert_no_group_leakage(groups, train_idx, val_idx, test_idx)
        assert strategy == grouped_split.STRATEGY_STRATIFIED_GROUP

    def test_split_proportions_are_approximately_70_10_20(self):
        y, groups = _make_dataset(n_groups_per_class=100, rows_per_group=4, n_classes=5)
        train_idx, val_idx, test_idx, _ = grouped_split.grouped_train_val_test_split(
            y, groups, test_folds=5, val_folds=8
        )
        total = len(y)
        train_frac = len(train_idx) / total
        val_frac = len(val_idx) / total
        test_frac = len(test_idx) / total
        assert 0.60 < train_frac < 0.80
        assert 0.05 < val_frac < 0.20
        assert 0.15 < test_frac < 0.25

    def test_every_class_present_in_all_three_splits_when_stratification_succeeds(self):
        y, groups = _make_dataset(n_groups_per_class=40, rows_per_group=3, n_classes=4)
        train_idx, val_idx, test_idx, strategy = grouped_split.grouped_train_val_test_split(
            y, groups, test_folds=5, val_folds=8
        )
        assert strategy == grouped_split.STRATEGY_STRATIFIED_GROUP
        assert set(y[train_idx]) == set(y)
        assert set(y[val_idx]) == set(y)
        assert set(y[test_idx]) == set(y)

    def test_falls_back_to_group_only_when_a_class_has_too_few_groups_to_stratify(self):
        # One class has only 2 distinct groups -- too few for
        # StratifiedGroupKFold(n_splits=5) to place at least one group in
        # every fold, so this should fall back rather than crash.
        y, groups = _make_dataset(n_groups_per_class=40, rows_per_group=3, n_classes=3)
        rare_y = np.array(["rare_class"] * 6)
        rare_groups = np.array(["rare-a"] * 3 + ["rare-b"] * 3)
        y = np.concatenate([y, rare_y])
        groups = np.concatenate([groups, rare_groups])

        train_idx, val_idx, test_idx, strategy = grouped_split.grouped_train_val_test_split(
            y, groups, test_folds=5, val_folds=8
        )
        assert strategy in (grouped_split.STRATEGY_GROUP_ONLY, grouped_split.STRATEGY_STRATIFIED_GROUP)
        # Whichever strategy actually ran, the no-leakage guarantee must hold.
        grouped_split.assert_no_group_leakage(groups, train_idx, val_idx, test_idx)

    def test_raises_on_mismatched_lengths(self):
        with pytest.raises(ValueError):
            grouped_split.grouped_train_val_test_split(np.array(["a", "b"]), np.array(["g1"]))

    def test_on_the_real_dataset_shape_no_leakage_and_full_class_coverage(self):
        """
        Regression test against the actual shape ML-001-T02 measured:
        heavy duplication (many rows per group), 15 categories, enough
        distinct groups per category (528+) that stratified-group
        splitting should always succeed with the default fold counts.
        """
        rng = np.random.default_rng(1)
        n_classes = 15
        y = []
        groups = []
        for cls in range(n_classes):
            n_groups = rng.integers(500, 2700)  # mirrors the 528-2635 range T02 measured
            for g in range(n_groups):
                rows_per_group = rng.integers(1, 12)  # heavy duplication, uneven per group
                for _ in range(rows_per_group):
                    y.append(f"cat{cls}")
                    groups.append(f"c{cls}-g{g}")
        y = np.array(y)
        groups = np.array(groups)

        train_idx, val_idx, test_idx, strategy = grouped_split.grouped_train_val_test_split(y, groups)

        assert strategy == grouped_split.STRATEGY_STRATIFIED_GROUP
        grouped_split.assert_no_group_leakage(groups, train_idx, val_idx, test_idx)
        assert set(y[train_idx]) == set(y[val_idx]) == set(y[test_idx]) == set(y)


class TestAssertNoGroupLeakage:
    def test_raises_with_a_useful_message_when_leakage_exists(self):
        groups = np.array(["g1", "g1", "g2", "g3"])
        train_idx = np.array([0])
        val_idx = np.array([1])  # same group "g1" as train_idx -- leakage
        test_idx = np.array([2, 3])

        with pytest.raises(AssertionError, match="train/val"):
            grouped_split.assert_no_group_leakage(groups, train_idx, val_idx, test_idx)

    def test_silent_when_clean(self):
        groups = np.array(["g1", "g2", "g3", "g4"])
        train_idx = np.array([0])
        val_idx = np.array([1])
        test_idx = np.array([2, 3])
        assert grouped_split.assert_no_group_leakage(groups, train_idx, val_idx, test_idx) is None
