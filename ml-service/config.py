"""
Centralized startup configuration validation (Phase G item 10).

This module does NOT replace the existing per-module environment reads
(db/mongo.py's MONGO_CONN/MONGO_DB_NAME, training/model_cleanup.py's
retention env vars, inference/predictor_manager.py's manifest-check
interval, app.py's timeout/regression env vars) -- those already have their
own documented, deliberate "read fresh on every call, fall back to a safe
default on a bad value" semantics from Phases B-F, and rewriting all of
them to route through a single accessor would be exactly the kind of large,
cross-cutting rewrite Phase G's own scope explicitly excludes.

Instead, this module adds ONE additional, early, best-effort validation
pass -- called once from app.py's startup handlers -- that inspects the
same environment variables and reports (via a structured summary, logged as
a single `config_validated` event) which ones are missing, malformed, or
out of a sane range, BEFORE the service is under any real traffic.

Two severities, per the Phase G real-environment acceptance policy:
  - ERRORS: (a) configuration that would leave the service structurally
    unable to do its job (a MONGO_CONN that is not even syntactically a
    Mongo URI; an ML_MODEL_ROOT that cannot be created or is not
    writable), AND (b) any numeric/threshold operational setting that was
    EXPLICITLY SUPPLIED (the env var is present) but is malformed or
    outside its valid range. An operator who set
    ML_MODEL_RETENTION_COUNT=-5 made a mistake, not a choice to "use the
    default" -- silently substituting the default in that case would hide
    a real misconfiguration behind seemingly-normal behavior. Startup
    FAILS for all of these.
  - WARNINGS: reserved for settings that are simply ABSENT (not set at
    all), where falling back to the documented default is the correct,
    intended behavior, not a masked error (e.g. no MONGO_CONN at all, no
    ML_OPERATIONS_TOKEN at all).

  Concretely: "absent -> use the documented default" and "explicitly
  supplied but invalid -> fatal startup error" are the only two outcomes
  for every numeric operational setting below (regression threshold,
  manifest-check interval, retention counts, retention days, feedback
  duplicate cap, and the two timeout/threshold seconds settings) -- there
  is no third "invalid value silently replaced with a default" path
  anymore for a setting the operator actually touched.

Never logs MONGO_CONN or ML_OPERATIONS_TOKEN values themselves, only
whether each is present/well-formed -- see `_describe_secret`.
"""

import os
import re

from observability import log_event

# Setting descriptors
_MONGO_URI_RE = re.compile(r"^mongodb(\+srv)?://")


def _is_valid_mongo_uri(value):
    return bool(value) and bool(_MONGO_URI_RE.match(value))


def _describe_secret(value):
    """Never returns the actual value -- only whether it is set, and (for a
    non-empty value) its length, which is enough for an operator to sanity-
    check "did my deploy pipeline actually inject this" without ever
    printing the secret itself."""
    if not value:
        return "unset"
    return f"set (length={len(value)})"


def _parse_int(value, default):
    try:
        return int(value), True
    except (TypeError, ValueError):
        return default, False


def _parse_float(value, default):
    try:
        return float(value), True
    except (TypeError, ValueError):
        return default, False


def validate_startup_config():
    """
    Reads the current environment (not cached -- called once at startup,
    same as every other startup handler in app.py) and returns:

        {"errors": [str, ...], "warnings": [str, ...], "summary": {...}}

    Never raises itself -- app.py's startup handler decides whether a
    non-empty `errors` list should abort startup (see its own docstring
    for exactly which two conditions are treated as fatal).
    """
    errors = []
    warnings = []
    summary = {}

    # Required for retraining/status endpoints; not for /predict-category, which is served from memory.
    mongo_conn = os.getenv("MONGO_CONN")
    if not mongo_conn:
        warnings.append(
            "MONGO_CONN is not set -- predictions will still work, but "
            "/retrain-model, startup reconciliation, and the operational "
            "status endpoints will fail until it is configured."
        )
        summary["mongoConn"] = "unset"
    elif not _is_valid_mongo_uri(mongo_conn):
        errors.append(
            "MONGO_CONN is set but is not a syntactically valid MongoDB "
            "URI (expected to start with mongodb:// or mongodb+srv://)."
        )
        summary["mongoConn"] = "invalid"
    else:
        summary["mongoConn"] = _describe_secret(mongo_conn)

    summary["mongoDbName"] = os.getenv("MONGO_DB_NAME", "auth-db")

    # Optional: operational endpoints fail closed (503) if unset, by design, not a startup error.
    ops_token = os.getenv("ML_OPERATIONS_TOKEN")
    summary["operationsToken"] = _describe_secret(ops_token)
    if not ops_token:
        warnings.append(
            "ML_OPERATIONS_TOKEN is not set -- /ml-status and /training-runs* "
            "will respond 503 (fail-closed) until it is configured. This is "
            "the intended degrade-safely behavior, not an error."
        )

    # Validated eagerly since a bad root would otherwise only surface during the first retrain.
    model_root = os.getenv("ML_MODEL_ROOT")
    effective_root = model_root or "<default: training/models next to this file>"
    summary["modelRoot"] = effective_root
    if model_root:
        try:
            os.makedirs(model_root, exist_ok=True)
            if not os.access(model_root, os.W_OK):
                errors.append(f"ML_MODEL_ROOT ({model_root!r}) exists but is not writable.")
        except OSError as exc:
            errors.append(f"ML_MODEL_ROOT ({model_root!r}) could not be created: {exc}")

    # Absent setting -> documented default; explicitly-set but invalid value -> fatal error, never silently replaced.
    def _check_positive_int(name, default):
        raw = os.getenv(name)
        if raw is None:
            summary[name] = default
            return
        value, parsed = _parse_int(raw, default)
        if not parsed or value <= 0:
            errors.append(
                f"{name}={raw!r} is explicitly set but is not a positive "
                f"integer."
            )
            summary[name] = f"invalid ({raw!r})"
        else:
            summary[name] = value

    def _check_nonnegative_int(name, default):
        raw = os.getenv(name)
        if raw is None:
            summary[name] = default
            return
        value, parsed = _parse_int(raw, default)
        if not parsed or value < 0:
            errors.append(
                f"{name}={raw!r} is explicitly set but is not a "
                f"non-negative integer."
            )
            summary[name] = f"invalid ({raw!r})"
        else:
            summary[name] = value

    _check_positive_int("ML_RETRAIN_STALE_TIMEOUT_SECONDS", 1800)
    _check_positive_int("ML_ORPHANED_RUN_THRESHOLD_SECONDS", 300)
    _check_positive_int("ML_MANIFEST_CHECK_INTERVAL_SECONDS", 5)
    _check_nonnegative_int("ML_MODEL_RETENTION_COUNT", 5)
    _check_nonnegative_int("ML_REJECTED_MODEL_RETENTION_COUNT", 3)
    _check_nonnegative_int("ML_MODEL_RETENTION_DAYS", 7)
    _check_nonnegative_int("ML_FEEDBACK_DUPLICATE_CAP", 3)

    raw_regression = os.getenv("ML_MAX_ACCURACY_REGRESSION")
    if raw_regression is None:
        summary["ML_MAX_ACCURACY_REGRESSION"] = 0.02
    else:
        value, parsed = _parse_float(raw_regression, 0.02)
        if not parsed or not (0.0 <= value <= 1.0):
            errors.append(
                f"ML_MAX_ACCURACY_REGRESSION={raw_regression!r} is "
                f"explicitly set but is not a number in [0, 1]."
            )
            summary["ML_MAX_ACCURACY_REGRESSION"] = f"invalid ({raw_regression!r})"
        else:
            summary["ML_MAX_ACCURACY_REGRESSION"] = value

    return {"errors": errors, "warnings": warnings, "summary": summary}


def run_and_log_startup_validation():
    """
    Convenience entry point for app.py's startup handler: runs
    validate_startup_config(), logs exactly one `config_validated` event
    with the counts (never the raw secret values -- see `summary`'s use of
    `_describe_secret`), and returns the same structured result so the
    caller can decide whether to raise on `errors`.
    """
    result = validate_startup_config()
    log_event(
        "config_validated",
        errorCount=len(result["errors"]),
        warningCount=len(result["warnings"]),
        mongoConn=result["summary"].get("mongoConn"),
        operationsToken=result["summary"].get("operationsToken"),
        modelRoot=result["summary"].get("modelRoot"),
    )
    for warning in result["warnings"]:
        print(f"[config] warning: {warning}")
    for error in result["errors"]:
        print(f"[config] ERROR: {error}")
    return result


class ConfigurationError(RuntimeError):
    """Raised by app.py's startup handler when validate_startup_config()
    reports one or more fatal errors -- never raised by this module
    itself, so importing config.py can never have a side effect."""
