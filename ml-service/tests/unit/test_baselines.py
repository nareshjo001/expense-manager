"""
[UNIT] ML-001-T04 -- training/baselines.py: majority, keyword, and
linear-model baselines that give T05's metrics something honest to
compare the real model against.
"""

import os
import sys

import numpy as np
import pytest
from scipy.sparse import csr_matrix

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "training")))

import baselines  # noqa: E402


class TestMajorityBaseline:
    def test_predicts_the_most_frequent_class_for_every_input(self):
        y = ["Food", "Food", "Food", "Transport", "Transport"]
        model = baselines.MajorityBaseline().fit(y)
        preds = model.predict(4)
        assert list(preds) == ["Food"] * 4

    def test_predict_accepts_a_list_and_uses_its_length(self):
        model = baselines.MajorityBaseline().fit(["Food", "Transport", "Food"])
        preds = model.predict(["a", "b", "c", "d"])
        assert len(preds) == 4
        assert all(p == "Food" for p in preds)

    def test_raises_on_empty_y(self):
        with pytest.raises(ValueError):
            baselines.MajorityBaseline().fit([])


class TestKeywordBaseline:
    def test_learns_a_distinctive_keyword_and_predicts_by_it(self):
        texts = ["coffee shop"] * 10 + ["bus ticket"] * 10
        y = ["Food"] * 10 + ["Transport"] * 10
        model = baselines.KeywordBaseline().fit(texts, y, min_count=5, min_precision=0.7)

        preds = model.predict(["coffee run", "bus pass"])
        assert preds[0] == "Food"
        assert preds[1] == "Transport"

    def test_falls_back_to_majority_class_for_unknown_text(self):
        texts = ["coffee shop"] * 10 + ["bus ticket"] * 10 + ["coffee shop"] * 5
        y = ["Food"] * 10 + ["Transport"] * 10 + ["Food"] * 5
        model = baselines.KeywordBaseline().fit(texts, y, min_count=5, min_precision=0.7)

        preds = model.predict(["completely unrelated words never seen"])
        assert preds[0] == "Food"  # the majority class (15 Food vs 10 Transport)

    def test_ignores_a_word_that_is_not_precise_enough_for_one_class(self):
        # "monthly" appears equally often in both classes -- should never
        # become a keyword for either at min_precision=0.7.
        texts = (
            ["monthly rent payment"] * 10
            + ["monthly gym membership"] * 10
        )
        y = ["Rent"] * 10 + ["Health"] * 10
        model = baselines.KeywordBaseline().fit(texts, y, min_count=5, min_precision=0.7)

        assert "monthly" not in model.keyword_map_

    def test_ignores_a_word_below_the_min_count_threshold(self):
        texts = ["raretoken item"] * 2 + ["common item"] * 20
        y = ["Others"] * 2 + ["Food"] * 20
        model = baselines.KeywordBaseline().fit(texts, y, min_count=5, min_precision=0.5)

        assert "raretoken" not in model.keyword_map_

    def test_raises_on_mismatched_lengths(self):
        with pytest.raises(ValueError):
            baselines.KeywordBaseline().fit(["a", "b"], ["Food"])


class TestLinearBaseline:
    def test_fits_and_predicts_on_a_sparse_feature_matrix(self):
        # Two obviously separable feature dimensions standing in for TF-IDF.
        X = csr_matrix(np.array([
            [1.0, 0.0],
            [1.0, 0.0],
            [1.0, 0.0],
            [0.0, 1.0],
            [0.0, 1.0],
            [0.0, 1.0],
        ]))
        y = np.array(["Food", "Food", "Food", "Transport", "Transport", "Transport"])

        model = baselines.LinearBaseline().fit(X, y)
        preds = model.predict(X)

        assert (preds == y).all()

    def test_is_deterministic_given_a_fixed_random_state(self):
        X = csr_matrix(np.random.RandomState(0).rand(40, 5))
        y = np.array(["A", "B"] * 20)

        model_a = baselines.LinearBaseline(random_state=7).fit(X, y)
        model_b = baselines.LinearBaseline(random_state=7).fit(X, y)

        assert (model_a.predict(X) == model_b.predict(X)).all()


class TestBuildAllBaselines:
    def test_returns_all_three_named_baselines(self):
        built = baselines.build_all_baselines()
        assert set(built.keys()) == {"majority", "keyword", "linear"}
        assert isinstance(built["majority"], baselines.MajorityBaseline)
        assert isinstance(built["keyword"], baselines.KeywordBaseline)
        assert isinstance(built["linear"], baselines.LinearBaseline)
