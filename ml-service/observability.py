"""Shared structured-logging and error-sanitization helpers (Phase F)."""

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
    """Centralized operational error-message sanitization (Phase F item 17)."""
    if value is None:
        return None
    text = str(value)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > max_length:
        text = text[: max_length - 3] + "..."
    return text


def log_event(event, level=logging.INFO, **fields):
    """Emits one structured lifecycle log record."""
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
