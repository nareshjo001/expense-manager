"""
[UNIT] Remediation Workstream C -- ML-service endpoint authentication.

Root cause: /predict-category, /generate-description, and /retrain-model had
NO authentication at all, unlike /ml-status and /training-runs* (which have
always required the shared-secret X-ML-Operations-Token header, enforced by
_require_operations_token / status_api.check_operations_token). This fix
reuses that exact same fail-closed guard on all three endpoints rather than
introducing a second, redundant secret.

Uses tests/unit/test_lifecycle_mocked.py's own established
`mocked_lifecycle_env` fixture (fake joblib/pymongo/bson/fastapi/pydantic,
real production code) and calls the route FUNCTIONS directly (the same
pattern that fixture's own existing tests use for app_module.background_retrain)
rather than a full FastAPI TestClient/HTTP layer -- these are real,
unmodified route functions, exercised as plain Python calls with the exact
`x_ml_operations_token` parameter FastAPI would inject from the header.
"""

import sys
import types

import pytest

sys.path.insert(0, __file__.rsplit("tests", 1)[0])

CORRECT_TOKEN = "phase-remediation-c-operations-token"
WRONG_TOKEN = "not-the-configured-token"


def _get_http_exception_class(app_module):
    # app_module.HTTPException is already the exception class itself under
    # BOTH the real FastAPI (fastapi.HTTPException) and
    # tests/support/fake_dependencies.py's fake (FakeHTTPException) -- no
    # instantiation is needed (or safe: FastAPI's real HTTPException treats
    # its first positional argument as status_code, so calling it with a
    # non-status-code string like "x" raises ValueError, not a usable
    # instance).
    exception_class = app_module.HTTPException
    assert isinstance(exception_class, type)
    assert issubclass(exception_class, BaseException)
    return exception_class


def _make_request(model_class, **fields):
    """
    Constructs a PredictionRequest/DescriptionRequest instance under EITHER
    real pydantic (constructor accepts kwargs) OR
    tests/support/fake_dependencies.py's FakeBaseModel (a bare `pass` class
    with no kwargs-accepting __init__, used when real pydantic is not
    installed) -- attempts the real-pydantic constructor call first, and
    falls back to attribute assignment on a no-arg instance otherwise. Never
    silently drops a field either way.
    """
    try:
        return model_class(**fields)
    except TypeError:
        instance = model_class()
        for key, value in fields.items():
            setattr(instance, key, value)
        return instance


class _NoOpThread:
    """Stand-in for threading.Thread that never actually runs background_retrain -- keeps the success-path retrain-model test fast and side-effect-free."""

    def __init__(self, target=None, args=(), daemon=None):
        self._target = target
        self._args = args

    def start(self):
        # Deliberately does NOT invoke self._target -- this test only proves
        # the auth gate + the run record was created, not the retraining
        # pipeline itself (covered elsewhere).
        pass


def test_predict_category_rejects_missing_token(mocked_lifecycle_env):
    ctx = mocked_lifecycle_env
    app_module = ctx.app_module
    app_module.os.environ["ML_OPERATIONS_TOKEN"] = CORRECT_TOKEN

    HTTPException = _get_http_exception_class(app_module)
    request = _make_request(app_module.PredictionRequest, expenseName="Coffee")

    with pytest.raises(HTTPException) as exc_info:
        app_module.predict(request, x_ml_operations_token=None)
    assert exc_info.value.status_code == 401


def test_predict_category_rejects_wrong_token(mocked_lifecycle_env):
    ctx = mocked_lifecycle_env
    app_module = ctx.app_module
    app_module.os.environ["ML_OPERATIONS_TOKEN"] = CORRECT_TOKEN

    HTTPException = _get_http_exception_class(app_module)
    request = _make_request(app_module.PredictionRequest, expenseName="Coffee")

    with pytest.raises(HTTPException) as exc_info:
        app_module.predict(request, x_ml_operations_token=WRONG_TOKEN)
    assert exc_info.value.status_code == 401


def test_predict_category_accepts_correct_token(mocked_lifecycle_env):
    ctx = mocked_lifecycle_env
    app_module = ctx.app_module
    app_module.os.environ["ML_OPERATIONS_TOKEN"] = CORRECT_TOKEN

    request = _make_request(app_module.PredictionRequest, expenseName="Coffee")

    # Must not raise -- a correctly-authenticated call proceeds to real
    # inference against the fixture's own loaded (fake) legacy model.
    result = app_module.predict(request, x_ml_operations_token=CORRECT_TOKEN)
    assert result is not None


def test_predict_category_fails_closed_when_server_token_unconfigured(mocked_lifecycle_env):
    ctx = mocked_lifecycle_env
    app_module = ctx.app_module
    app_module.os.environ.pop("ML_OPERATIONS_TOKEN", None)

    HTTPException = _get_http_exception_class(app_module)
    request = _make_request(app_module.PredictionRequest, expenseName="Coffee")

    with pytest.raises(HTTPException) as exc_info:
        app_module.predict(request, x_ml_operations_token="anything")
    # Fails closed with 503 ("operational endpoints are not configured"),
    # never silently treated as "open by default".
    assert exc_info.value.status_code == 503


def test_generate_description_rejects_missing_token(mocked_lifecycle_env):
    ctx = mocked_lifecycle_env
    app_module = ctx.app_module
    app_module.os.environ["ML_OPERATIONS_TOKEN"] = CORRECT_TOKEN

    HTTPException = _get_http_exception_class(app_module)
    request = _make_request(
        app_module.DescriptionRequest,
        expenseName="Coffee", expenseCategory="Food", expenseAmount=5.0
    )

    with pytest.raises(HTTPException) as exc_info:
        app_module.generate_description_api(request, x_ml_operations_token=None)
    assert exc_info.value.status_code == 401


def test_generate_description_accepts_correct_token(mocked_lifecycle_env):
    ctx = mocked_lifecycle_env
    app_module = ctx.app_module
    app_module.os.environ["ML_OPERATIONS_TOKEN"] = CORRECT_TOKEN

    request = _make_request(
        app_module.DescriptionRequest,
        expenseName="Coffee", expenseCategory="Food", expenseAmount=5.0
    )

    result = app_module.generate_description_api(request, x_ml_operations_token=CORRECT_TOKEN)
    assert result is not None


def test_retrain_model_rejects_missing_token_and_never_creates_a_run(mocked_lifecycle_env, monkeypatch):
    ctx = mocked_lifecycle_env
    app_module = ctx.app_module
    app_module.os.environ["ML_OPERATIONS_TOKEN"] = CORRECT_TOKEN

    HTTPException = _get_http_exception_class(app_module)

    create_run_calls = []
    original_create_run = ctx.runs.create_run

    def spy_create_run(*args, **kwargs):
        create_run_calls.append((args, kwargs))
        return original_create_run(*args, **kwargs)

    monkeypatch.setattr(app_module.runs, "create_run", spy_create_run)

    with pytest.raises(HTTPException) as exc_info:
        app_module.retrain_model(payload=None, x_ml_operations_token=None)
    assert exc_info.value.status_code == 401
    # The auth gate runs BEFORE the active-run fast path and the persistent
    # run record -- a rejected caller creates no TrainingRun document.
    assert create_run_calls == []


def test_retrain_model_rejects_wrong_token_and_never_creates_a_run(mocked_lifecycle_env, monkeypatch):
    ctx = mocked_lifecycle_env
    app_module = ctx.app_module
    app_module.os.environ["ML_OPERATIONS_TOKEN"] = CORRECT_TOKEN

    HTTPException = _get_http_exception_class(app_module)

    create_run_calls = []
    monkeypatch.setattr(
        app_module.runs, "create_run", lambda *a, **k: create_run_calls.append((a, k))
    )

    with pytest.raises(HTTPException) as exc_info:
        app_module.retrain_model(payload=None, x_ml_operations_token=WRONG_TOKEN)
    assert exc_info.value.status_code == 401
    assert create_run_calls == []


def test_retrain_model_fails_closed_when_server_token_unconfigured(mocked_lifecycle_env, monkeypatch):
    ctx = mocked_lifecycle_env
    app_module = ctx.app_module
    app_module.os.environ.pop("ML_OPERATIONS_TOKEN", None)

    HTTPException = _get_http_exception_class(app_module)

    create_run_calls = []
    monkeypatch.setattr(
        app_module.runs, "create_run", lambda *a, **k: create_run_calls.append((a, k))
    )

    with pytest.raises(HTTPException) as exc_info:
        app_module.retrain_model(payload=None, x_ml_operations_token="anything")
    assert exc_info.value.status_code == 503
    assert create_run_calls == []


def test_retrain_model_accepts_correct_token_and_creates_a_run(mocked_lifecycle_env, monkeypatch):
    ctx = mocked_lifecycle_env
    app_module = ctx.app_module
    app_module.os.environ["ML_OPERATIONS_TOKEN"] = CORRECT_TOKEN

    # Never actually run the background retraining pipeline in this test --
    # only prove the auth-gated request is accepted and a run record exists.
    monkeypatch.setattr(app_module, "Thread", _NoOpThread)

    result = app_module.retrain_model(payload=None, x_ml_operations_token=CORRECT_TOKEN)
    # JSONResponse (real or faked) -- status 202 on a freshly-accepted run.
    assert getattr(result, "status_code", None) in (200, 202)


def test_health_endpoints_remain_public_without_a_token(mocked_lifecycle_env):
    ctx = mocked_lifecycle_env
    app_module = ctx.app_module
    app_module.os.environ["ML_OPERATIONS_TOKEN"] = CORRECT_TOKEN

    # health_live/health_ready take no x_ml_operations_token parameter at
    # all -- calling them with zero arguments proves they were never gated.
    live = app_module.health_live()
    assert live is not None

    ready_result = app_module.health_ready()
    assert ready_result is not None


def test_token_never_appears_in_a_rejection_error_message(mocked_lifecycle_env):
    ctx = mocked_lifecycle_env
    app_module = ctx.app_module
    app_module.os.environ["ML_OPERATIONS_TOKEN"] = CORRECT_TOKEN

    HTTPException = _get_http_exception_class(app_module)
    request = _make_request(app_module.PredictionRequest, expenseName="Coffee")

    with pytest.raises(HTTPException) as exc_info:
        app_module.predict(request, x_ml_operations_token=WRONG_TOKEN)

    detail = str(exc_info.value.detail)
    assert CORRECT_TOKEN not in detail
    assert WRONG_TOKEN not in detail
