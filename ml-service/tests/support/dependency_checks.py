"""
Distinguishes "package genuinely absent" (skip) from "package installed but
its import is broken/shadowed" (hard failure) -- Phase G pytest-harness-
isolation fix item 6.

`pytest.importorskip(name)` already does the right thing BY ITSELF: it only
catches `ImportError`/`ModuleNotFoundError` (a package that truly isn't
installed) and lets any other exception propagate as a normal test error.
The observed `AttributeError: module 'joblib' has no attribute 'Parallel'`
in the real Windows run was never caused by `importorskip` swallowing the
wrong exception type -- it was caused by `tests/conftest.py` installing a
FAKE `joblib` into `sys.modules` at collection time (see conftest.py's own
docstring for that fix), so by the time scikit-learn ran `import joblib`
internally, it found the fake module already cached there. With that fixed,
`pytest.importorskip` alone is correct and sufficient.

This module exists anyway, for two reasons:
  1. To give test files an explicit, named helper
     (`require_real_dependency`) for the one case `importorskip` cannot
     express on its own: "the module imported fine, but a SPECIFIC
     attribute I need is missing" -- which is exactly the
     joblib.Parallel symptom. Using this helper (or the equivalent
     explicit assertion) makes that distinction a hard failure with a
     diagnostic message, never a silent skip.
  2. So no test file is ever tempted to reach for a broad
     `except Exception: pytest.skip(...)` around an import, which WOULD
     incorrectly convert a broken/shadowed installation into a false
     "not installed" result -- something this project explicitly must
     never do (see the Phase G brief's item 6).
"""

import importlib

import pytest


def require_real_dependency(module_name, required_attr=None):
    """
    Returns the imported module if it is genuinely installed and (when
    `required_attr` is given) exposes that attribute.

      - ImportError / ModuleNotFoundError -> `pytest.skip(...)` (package
        absent -- a legitimate, expected outcome in an environment that
        hasn't installed the optional real dependency).
      - Import succeeds but `required_attr` is missing -> raises
        AssertionError with a diagnostic pointing at the module's own
        `__file__`, so a shadowed/poisoned/broken installation is a loud
        test FAILURE, never mistaken for "not installed".
      - Any other exception during import (a genuine, unexpected error)
        is left to propagate unchanged -- never caught here.
    """
    try:
        module = importlib.import_module(module_name)
    except ImportError as exc:
        pytest.skip(f"{module_name} is not installed in this environment: {exc}")
        return None  # unreachable -- pytest.skip raises internally

    if required_attr is not None and not hasattr(module, required_attr):
        raise AssertionError(
            f"{module_name} imported successfully but does not expose "
            f"{required_attr!r} -- this indicates a broken or SHADOWED "
            f"installation (e.g. a fake/stub module left in sys.modules, "
            f"or a same-named file/directory earlier on sys.path), not a "
            f"genuinely absent package. Module resolved from: "
            f"{getattr(module, '__file__', '<no __file__ -- likely a fake/stub module>')}"
        )

    return module
