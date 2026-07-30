"""
Shared fixtures for REAL-dependency integration tests (Phase G item 3/4).

These tests require the REAL pymongo package AND a reachable test MongoDB
instance -- they never fall back to the fakes in tests/unit/conftest.py.
If either is unavailable, tests using `real_test_db` are skipped (not
failed, and never silently replaced with a mock) via `pytest.skip`, so a
`pytest tests/integration` run reports exactly what did or did not execute.

Safety (Phase G item 3, "never run integration tests against the normal
auth-db without isolation"):
  - the target database name is read from ML_TEST_MONGO_DB_NAME (see
    .env.example) and MUST contain the substring "test", checked BEFORE
    any connection is attempted -- if it doesn't, every test using this
    fixture fails closed with a clear assertion, never silently proceeding
    against a database that might be production.
  - the fixture never calls drop_database; it only deletes documents this
    test session itself inserted (tracked via `_test_run_marker`), so a
    misconfigured shared test database still can't lose other data.
"""

import os
import uuid

import pytest

pymongo = pytest.importorskip("pymongo", reason="pymongo is not installed in this environment")

TEST_RUN_MARKER = f"phase-g-test-{uuid.uuid4().hex[:8]}"


def _test_db_name():
    return os.getenv("ML_TEST_MONGO_DB_NAME", "")


@pytest.fixture(scope="session")
def real_test_db():
    db_name = _test_db_name()
    assert "test" in db_name.lower(), (
        f"ML_TEST_MONGO_DB_NAME={db_name!r} does not contain 'test' -- refusing to run "
        f"integration tests against a database that isn't clearly a test database. "
        f"Set ML_TEST_MONGO_DB_NAME (e.g. auth-db-ml-integration-test) before running "
        f"tests/integration/."
    )
    conn = os.getenv("ML_TEST_MONGO_CONN")
    if not conn:
        pytest.skip("ML_TEST_MONGO_CONN is not set -- no test MongoDB instance configured.")

    try:
        client = pymongo.MongoClient(conn, serverSelectionTimeoutMS=3000)
        client.admin.command("ping")
    except Exception as exc:
        pytest.skip(f"Could not reach the configured test MongoDB instance: {exc}")

    db = client[db_name]
    yield db

    # Cleanup: only documents this session marked, never drop_database.
    for collection_name in ("mltrainingruns", "mltraininglocks", "mlfeedbacks"):
        db[collection_name].delete_many({"_testRunMarker": TEST_RUN_MARKER})
    client.close()
