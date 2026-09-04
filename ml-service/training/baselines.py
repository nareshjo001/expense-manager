"""
ML-001-T04 -- majority, keyword, and linear-model baselines.

These exist to answer one question T05/T07 need an honest answer to:
is the RandomForestClassifier trainer.py trains actually earning its
complexity, or would a much simpler (and much cheaper to run/debug)
model do about as well? A candidate model's accuracy/macro-F1 only
means something in comparison to what a trivial baseline already
achieves -- reporting 82% accuracy sounds good until a majority-class
baseline also gets 70% because one category dominates the dataset.

All three share a minimal fit/predict interface so
training/metrics.py (T05) can evaluate them the same way it evaluates
the real model, on the same held-out split.

- MajorityBaseline: always predicts the single most frequent training
  class. The floor every other model must clear.
- KeywordBaseline: a transparent, inspectable rule -- for each word seen
  often enough and skewed enough toward one class in training, predicts
  that class when the word appears in the input text; falls back to the
  majority class otherwise. Answers "how far do you get with literal
  keyword matching, no ML at all."
- LinearBaseline: scikit-learn LogisticRegression over the SAME TF-IDF
  features trainer.py's RandomForestClassifier trains on, so the
  comparison to the real model isolates "does a much simpler model class
  do almost as well on the same features," not "do different features
  help."
"""

from collections import Counter, defaultdict

import numpy as np
from sklearn.linear_model import LogisticRegression


class MajorityBaseline:
    """Predicts the single most frequent training-set class for every input."""

    def fit(self, y):
        y = np.asarray(y)
        if len(y) == 0:
            raise ValueError("MajorityBaseline.fit: cannot fit on an empty y")
        counts = Counter(y)
        # Counter.most_common ties break by first-seen insertion order --
        # deterministic given a fixed y, which is what matters here (not
        # matching any particular tie-break convention).
        self.majority_class_ = counts.most_common(1)[0][0]
        return self

    def predict(self, n_or_texts):
        n = n_or_texts if isinstance(n_or_texts, (int, np.integer)) else len(n_or_texts)
        return np.array([self.majority_class_] * n)


class KeywordBaseline:
    """
    A transparent rule-based baseline: for each whitespace-separated
    token seen at least `min_count` times in training text and
    associated with one class at least `min_precision` of the time it
    appears, that token predicts that class. An input predicts by
    majority vote among its tokens' known classes; ties and inputs with
    no known token fall back to the majority class.
    """

    def fit(self, texts, y, min_count=5, min_precision=0.7):
        texts = list(texts)
        y = np.asarray(y)
        if len(texts) != len(y):
            raise ValueError(
                f"KeywordBaseline.fit: {len(texts)} texts vs {len(y)} labels"
            )

        self._majority = MajorityBaseline().fit(y)

        token_class_counts = defaultdict(Counter)
        for text, label in zip(texts, y):
            for token in str(text).split():
                token_class_counts[token][label] += 1

        self.keyword_map_ = {}
        for token, class_counts in token_class_counts.items():
            total = sum(class_counts.values())
            if total < min_count:
                continue
            best_class, best_count = class_counts.most_common(1)[0]
            if (best_count / total) >= min_precision:
                self.keyword_map_[token] = best_class

        return self

    def predict(self, texts):
        predictions = []
        for text in texts:
            votes = Counter()
            for token in str(text).split():
                predicted = self.keyword_map_.get(token)
                if predicted is not None:
                    votes[predicted] += 1
            if votes:
                predictions.append(votes.most_common(1)[0][0])
            else:
                predictions.append(self._majority.majority_class_)
        return np.array(predictions)


class LinearBaseline:
    """LogisticRegression over the same feature matrix the real model trains on."""

    def __init__(self, max_iter=1000, random_state=42, **kwargs):
        self.model = LogisticRegression(max_iter=max_iter, random_state=random_state, **kwargs)

    def fit(self, X, y):
        self.model.fit(X, y)
        return self

    def predict(self, X):
        return self.model.predict(X)


def build_all_baselines():
    """Returns a {name: unfit baseline instance} dict, the shape T05's evaluation report expects."""
    return {
        "majority": MajorityBaseline(),
        "keyword": KeywordBaseline(),
        "linear": LinearBaseline(),
    }
