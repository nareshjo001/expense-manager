"""
[UNIT] Real, unmocked tests for config.py's startup validation.

No fakes needed here -- config.py only depends on the stdlib and
observability.py (also pure stdlib), so these tests run against the REAL
module in any environment with Python 3.10+, regardless of whether
pymongo/fastapi/scikit-learn are installed.
"""

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import config  # noqa: E402


def _clear_ml_env(monkeypatch):
    for key in list(os.environ):
        if key.startswith("ML_") or key in ("MONGO_CONN", "MONGO_DB_NAME"):
            monkeypatch.delenv(key, raising=False)


def test_missing_mongo_conn_is_a_warning_not_an_error(monkeypatch):
    _clear_ml_env(monkeypatch)
    result = config.validate_startup_config()
    assert result["errors"] == []
    assert any("MONGO_CONN is not set" in w for w in result["warnings"])


def test_malformed_mongo_conn_is_a_fatal_error(monkeypatch):
    _clear_ml_env(monkeypatch)
    monkeypatch.setenv("MONGO_CONN", "not-a-mongo-uri")
    result = config.validate_startup_config()
    assert any("not a syntactically valid MongoDB URI" in e for e in result["errors"])


def test_valid_mongo_conn_passes(monkeypatch):
    _clear_ml_env(monkeypatch)
    monkeypatch.setenv("MONGO_CONN", "mongodb+srv://user:pass@cluster0.example.net/db")
    result = config.validate_startup_config()
    assert result["errors"] == []


def test_secret_values_are_never_returned_verbatim(monkeypatch):
    _clear_ml_env(monkeypatch)
    monkeypatch.setenv("MONGO_CONN", "mongodb://user:supersecret@localhost:27017/db")
    monkeypatch.setenv("ML_OPERATIONS_TOKEN", "top-secret-token-value")
    result = config.validate_startup_config()
    dumped = str(result)
    assert "supersecret" not in dumped
    assert "top-secret-token-value" not in dumped
    assert "set (length=" in result["summary"]["operationsToken"]


def test_missing_operations_token_is_a_warning_not_an_error(monkeypatch):
    _clear_ml_env(monkeypatch)
    result = config.validate_startup_config()
    assert result["errors"] == []
    assert any("ML_OPERATIONS_TOKEN is not set" in w for w in result["warnings"])


def test_negative_retention_count_explicitly_set_is_a_fatal_error(monkeypatch):
    _clear_ml_env(monkeypatch)
    monkeypatch.setenv("ML_MODEL_RETENTION_COUNT", "-5")
    result = config.validate_startup_config()
    assert any("ML_MODEL_RETENTION_COUNT" in e for e in result["errors"])
    # This is an error, not a warning -- no warning should ALSO be emitted for this same setting.
    assert not any("ML_MODEL_RETENTION_COUNT" in w for w in result["warnings"])


def test_non_numeric_manifest_interval_explicitly_set_is_a_fatal_error(monkeypatch):
    _clear_ml_env(monkeypatch)
    monkeypatch.setenv("ML_MANIFEST_CHECK_INTERVAL_SECONDS", "not-a-number")
    result = config.validate_startup_config()
    assert any("ML_MANIFEST_CHECK_INTERVAL_SECONDS" in e for e in result["errors"])
    assert not any("ML_MANIFEST_CHECK_INTERVAL_SECONDS" in w for w in result["warnings"])


def test_zero_manifest_check_interval_explicitly_set_is_a_fatal_error(monkeypatch):
    _clear_ml_env(monkeypatch)
    monkeypatch.setenv("ML_MANIFEST_CHECK_INTERVAL_SECONDS", "0")
    result = config.validate_startup_config()
    assert any("ML_MANIFEST_CHECK_INTERVAL_SECONDS" in e for e in result["errors"])


def test_regression_threshold_out_of_range_explicitly_set_is_a_fatal_error(monkeypatch):
    _clear_ml_env(monkeypatch)
    monkeypatch.setenv("ML_MAX_ACCURACY_REGRESSION", "5.0")
    result = config.validate_startup_config()
    assert any("ML_MAX_ACCURACY_REGRESSION" in e for e in result["errors"])
    assert not any("ML_MAX_ACCURACY_REGRESSION" in w for w in result["warnings"])


def test_negative_feedback_duplicate_cap_explicitly_set_is_a_fatal_error(monkeypatch):
    _clear_ml_env(monkeypatch)
    monkeypatch.setenv("ML_FEEDBACK_DUPLICATE_CAP", "-1")
    result = config.validate_startup_config()
    assert any("ML_FEEDBACK_DUPLICATE_CAP" in e for e in result["errors"])


def test_absent_numeric_settings_use_documented_defaults_without_error_or_warning(monkeypatch):
    _clear_ml_env(monkeypatch)
    result = config.validate_startup_config()
    numeric_related_messages = [
        m for m in (result["errors"] + result["warnings"])
        if any(name in m for name in (
            "ML_RETRAIN_STALE_TIMEOUT_SECONDS", "ML_ORPHANED_RUN_THRESHOLD_SECONDS",
            "ML_MANIFEST_CHECK_INTERVAL_SECONDS", "ML_MODEL_RETENTION_COUNT",
            "ML_REJECTED_MODEL_RETENTION_COUNT", "ML_MODEL_RETENTION_DAYS",
            "ML_FEEDBACK_DUPLICATE_CAP", "ML_MAX_ACCURACY_REGRESSION",
        ))
    ]
    assert numeric_related_messages == []
    assert result["summary"]["ML_MANIFEST_CHECK_INTERVAL_SECONDS"] == 5
    assert result["summary"]["ML_MODEL_RETENTION_COUNT"] == 5
    assert result["summary"]["ML_MAX_ACCURACY_REGRESSION"] == 0.02


def test_valid_full_configuration_has_no_errors_or_warnings(monkeypatch):
    _clear_ml_env(monkeypatch)
    monkeypatch.setenv("MONGO_CONN", "mongodb+srv://user:pass@cluster0.example.net/db")
    monkeypatch.setenv("ML_OPERATIONS_TOKEN", "a-real-token")
    monkeypatch.setenv("ML_RETRAIN_STALE_TIMEOUT_SECONDS", "1800")
    monkeypatch.setenv("ML_ORPHANED_RUN_THRESHOLD_SECONDS", "300")
    monkeypatch.setenv("ML_MANIFEST_CHECK_INTERVAL_SECONDS", "5")
    monkeypatch.setenv("ML_MODEL_RETENTION_COUNT", "5")
    monkeypatch.setenv("ML_REJECTED_MODEL_RETENTION_COUNT", "3")
    monkeypatch.setenv("ML_MODEL_RETENTION_DAYS", "7")
    monkeypatch.setenv("ML_FEEDBACK_DUPLICATE_CAP", "3")
    monkeypatch.setenv("ML_MAX_ACCURACY_REGRESSION", "0.02")
    result = config.validate_startup_config()
    assert result["errors"] == []
    assert result["warnings"] == []


def test_unwritable_model_root_is_a_fatal_error(monkeypatch, tmp_path):
    _clear_ml_env(monkeypatch)
    unwritable = tmp_path / "readonly-root"
    unwritable.mkdir()
    os.chmod(unwritable, 0o400)
    try:
        monkeypatch.setenv("ML_MODEL_ROOT", str(unwritable))
        result = config.validate_startup_config()
        if os.access(str(unwritable), os.W_OK):
            # Running as root can bypass the permission bit entirely -- skip rather than false-fail.
            import pytest
            pytest.skip("effective UID can write regardless of the permission bit (likely running as root)")
        assert any("ML_MODEL_ROOT" in e for e in result["errors"])
    finally:
        os.chmod(unwritable, 0o700)
