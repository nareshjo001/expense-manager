"""
Shared MongoDB connection for the ML service (Phase B).

Centralizes .env loading and MongoClient construction so the training-run
repository (and any future in-process MongoDB access) reuses a single,
process-wide client instead of opening a new connection per call.

Note: `training/export_feedback.py` runs as its own subprocess (invoked by
retrain_pipeline.py), not imported in-process, so it intentionally keeps its
own standalone MongoClient for now. Refactoring it is out of scope for
Phase B ("preserve the existing export -> merge -> trainer subprocess
workflow", "do not yet change dataset semantics").
"""

import os
import threading

from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import PyMongoError

load_dotenv()

MONGO_CONN = os.getenv("MONGO_CONN")

# Reuses the same "auth-db" database training/export_feedback.py already targets; overridable via env var.
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "auth-db")


class MongoConfigurationError(RuntimeError):
    """
    Raised when MongoDB configuration is missing or the client cannot be
    constructed.

    This is a RECOVERABLE, request-time error. Callers (the /retrain-model
    route, the training-run repository) must catch this and turn it into a
    controlled HTTP error — it must never be allowed to crash the process at
    import time or during application startup (unlike the existing
    inference/predictor.py pattern of calling sys.exit() on load failure,
    which Phase B deliberately does not repeat here).
    """


_client_lock = threading.Lock()
_client = None


def get_client():
    """
    Return a lazily-created, process-wide MongoClient, reused across calls
    instead of opening a new connection per request.

    Never logs MONGO_CONN or any part of it — the connection string contains
    credentials.
    """
    global _client

    if _client is not None:
        return _client

    with _client_lock:
        if _client is not None:
            return _client

        if not MONGO_CONN:
            raise MongoConfigurationError(
                "MONGO_CONN is not configured for the ML service."
            )

        try:
            client = MongoClient(
                MONGO_CONN,
                serverSelectionTimeoutMS=5000
            )
        except PyMongoError as exc:
            raise MongoConfigurationError(
                "Failed to initialize the MongoDB client."
            ) from exc

        _client = client
        return _client


def get_db():
    """Return the ML service's MongoDB database handle."""
    return get_client()[MONGO_DB_NAME]
