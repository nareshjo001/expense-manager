"""
Shared structured-logging and error-sanitization helpers (Phase F).

Single place that owns:
  - a configured `logging` logger for retraining/activation lifecycle events
    (log_event) -- Python's standard library `logging` module is used
    directly; no third-party logging platform is introduced.
  - centralized operational error-message sanitization (sanitize_reason),
    used everywhere a failure reason is persisted to MongoDB or returned
    from an API response, so client-facing/DB-stored text never contains
    raw stack traces, newlines, or unbounded length.

Design notes:
  - `log_event(event, **fields)` emits ONE log record per call, with the
    event name and every field individually visible both in the
    human-readable message and in the record's `extra` dict (for log
    aggregators that parse structured fields out of LogRecord.__dict__).
    Callers should call this ONCE per logical lifecycle transition -- see
    each call site's own comment for why it isn't called from a second
    layer for the same transition.
  - Values are sanitized before formatting -- no raw exception objects,
    no multi-line text, no unbounded strings are ever passed through
    verbatim. Full tracebacks belong only in `logger.exception(...)` calls
    at the exact point an unexpected exception is caught, never in a
    lifecycle event record and never in an API response.
  - No user expense text or credentials are ever intentionally logged by
    any call site using this helper -- reviewers should treat any lifecycle
    log call passing an expense name, MongoDB connection string, or token
    value as a bug.
"""

import re
import logging

logger = logging.getLogger("ml-service.lifecycle")
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(_handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False


def sanitize_reason(value, max_length=500):
    """
    Centralized operational error-message sanitization (Phase F item 17).

    - Collapses all whitespace (including embedded newlines/carriage
      returns, which could otherwise be used to forge additional fake log
      lines) into single spaces.
    - Truncates to `max_length` characters, appending "..." when
      truncated, so a single oversized message can never blow out a log
      line or a MongoDB document.
    - Returns None for None input (callers can distinguish "no error" from
      "empty error string").

    This does NOT attempt to strip absolute filesystem paths that might
    appear inside an exception's own message text (Python exceptions often
    embed them, e.g. FileNotFoundError) -- doing that reliably without
    corrupting legitimate diagnostic content is out of scope for this
    phase; this function focuses on the structural risks (log injection
    via newlines, unbounded length) that are safe to fix universally.
    Callers that construct their OWN messages (e.g. HTTPException details)
    should avoid interpolating raw paths into them in the first place.
    """
    if value is None:
        return None
    text = str(value)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > max_length:
        text = text[: max_length - 3] + "..."
    return text


def log_event(event, level=logging.INFO, **fields):
    """
    Emits one structured lifecycle log record.

    `fields` are sanitized (strings run through sanitize_reason with a
    shorter cap, so a field never dominates the log line) before being
    attached both to the human-readable message and to the record's
    `extra` dict (accessible to log-aggregation backends without needing
    to parse the message text).

    Deliberately synchronous and cheap -- no network I/O, no third-party
    SDK. A failure to log must never be allowed to raise into the caller's
    own control flow, so this is wrapped in its own try/except.
    """
    try:
        safe_fields = {}
        for key, val in fields.items():
            if isinstance(val, str):
                safe_fields[key] = sanitize_reason(val, max_length=300)
            else:
                safe_fields[key] = val

        field_str = " ".join(f"{k}={v!r}" for k, v in safe_fields.items())
        message = f"event={event!r} {field_str}".strip()
        logger.log(level, message, extra={"event": event, **safe_fields})
    except Exception:
        # Logging must never be able to break the caller.
        pass
