"""
Pickleable fake sklearn-shaped objects, used by tests/conftest.py's
`mocked_lifecycle_env` fixture to stand in for a real scikit-learn model/
vectorizer/encoder wherever real scikit-learn/joblib are not installed.

Why this file exists (Phase G pytest-harness-isolation fix): these classes
are pickled for real, via the real production `model_bundle.write_bundle` ->
`joblib.dump` (or the fake joblib's `pickle.dump` stand-in) code path.
Pickle records a class's `__module__` + `__qualname__` at dump time and
re-resolves that exact module at load time via `sys.modules[__module__]`.
Previously these classes were defined directly inside `conftest.py` --
harmless on its own, EXCEPT that pytest was also collecting a SECOND,
different file also literally named `conftest.py` in a sibling directory
(`tests/unit/conftest.py`), and pytest (without `tests/unit/__init__.py`)
imported both under the same ambiguous top-level module name `conftest`.
Depending on import order, `sys.modules["conftest"]` could end up pointing
at whichever file was imported LAST, which is not necessarily the one that
actually defined the class instance being unpickled -- producing exactly
the observed `PicklingError: Can't pickle <class 'conftest.FakeModel'>:
it's not found as conftest.FakeModel`.

Moving these classes to `tests/support/fake_ml_objects.py` (a real,
unambiguous, dotted-path package thanks to tests/__init__.py and
tests/support/__init__.py) gives them a `__module__` of
`"tests.support.fake_ml_objects"` -- a name that resolves to exactly one
file, regardless of how many `conftest.py` files pytest also happens to
load in the same session.
"""

import numpy as np


class FakeVectorizer:
    def __init__(self, n_features=4):
        self.vocabulary_ = {f"tok{i}": i for i in range(n_features)}

    def transform(self, inputs):
        return np.zeros((len(inputs), len(self.vocabulary_)))


class FakeModel:
    def __init__(self, n_features_in_=4, n_classes=3):
        self.n_features_in_ = n_features_in_
        self.classes_ = list(range(n_classes))

    def predict(self, X):
        return np.zeros(X.shape[0], dtype=int)

    def predict_proba(self, X):
        row = [0.0] * len(self.classes_)
        row[0] = 1.0
        return np.array([row for _ in range(X.shape[0])])


class FakeEncoder:
    def __init__(self, categories=("Food", "Transport", "Groceries")):
        self.classes_ = list(categories)

    def inverse_transform(self, preds):
        return [self.classes_[p] for p in preds]


def make_pipeline(n_features=4, categories=("Food", "Transport", "Groceries")):
    return FakeModel(n_features, len(categories)), FakeVectorizer(n_features), FakeEncoder(categories)
