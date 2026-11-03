"""Shared MongoDB connection for the ML service (Phase B)."""

import os
import threading

from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import PyMongoError

load_dotenv()

MONGO_CONN = os.getenv("MONGO_CONN")

# Shared application database; overridable via environment variable.
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "auth-db")


class MongoConfigurationError(RuntimeError):
    """Raised when MongoDB configuration is missing or the client cannot be constructed."""


_client_lock = threading.Lock()
_client = None


def get_client():
    """Return a lazily-created, process-wide MongoClient, reused across calls instead of opening a new connection per request."""
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
