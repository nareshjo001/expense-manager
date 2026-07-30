# ml-service test suite

```
tests/
  __init__.py               # makes `tests` a real package (see support/ below)
  conftest.py               # the ONLY conftest.py defining mocked-dependency fixtures
  support/
    __init__.py
    fake_ml_objects.py      # FakeModel/FakeVectorizer/FakeEncoder -- pickleable, stable dotted path
    fake_dependencies.py    # fake joblib/pymongo/bson/fastapi/pydantic module BUILDERS (no import-time install)
    dependency_checks.py    # require_real_dependency() -- absent (skip) vs broken/shadowed (fail) distinction
  unit/                     # [UNIT] real production code + fixtures from ../conftest.py
  integration/
    conftest.py             # REAL pymongo + real_test_db fixture (ML_TEST_MONGO_CONN / ML_TEST_MONGO_DB_NAME)
  process/                  # [PROCESS-RESTART] / [MULTI-PROCESS] real subprocess boundaries
  contracts/                # [BACKEND-CONTRACT] backend source assertions + live prediction-shape checks
  failure_injection/        # [FILESYSTEM]/[UNIT] targeted failure injection, fixtures from ../conftest.py
```

**Isolation note (Phase G pytest-harness fix):** `tests/conftest.py` is the
only file in this tree that defines the mocked `FakeModel`/`FakeVectorizer`/
`FakeEncoder` classes (via `tests/support/fake_ml_objects.py`, a real
importable package — required so `pickle` can resolve their `__module__`
correctly) and the only file that installs fake joblib/pymongo/bson/
fastapi/pydantic modules — and it does so ONLY inside the
`mocked_lifecycle_env` fixture, scoped to pytest's `monkeypatch`, never at
import/collection time. This is what prevents a fake `joblib` from ever
leaking into `tests/integration/test_real_training.py`'s real scikit-learn
import.

## Commands

```bash
# Unit tests only (fast, no real MongoDB/scikit-learn required):
pytest tests/unit tests/failure_injection tests/contracts -v

# Integration + process tests (requires the pinned requirements.txt
# installed for real, plus a reachable test MongoDB for the tests that
# need one — see .env.example's ML_TEST_MONGO_CONN/ML_TEST_MONGO_DB_NAME):
pytest tests/integration tests/process -v

# Full verification (everything):
pytest tests/ -v
```

Tests that require a real dependency not installed in the current
environment `pytest.importorskip` and report as **skipped**, never as a
silent mock substitution under the real-dependency label — see
`PHASE_G_FINAL_REPORT.md` (repo root) for exactly which categories
executed for real vs. were skipped in this project's own CI/agent
environment, and why.

## Configuring a local MongoDB test database (Windows / PowerShell)

`tests/integration/conftest.py`'s `real_test_db` fixture reads TWO
dedicated environment variables — **never** the production `MONGO_CONN` —
and refuses to run (via a plain `assert`) unless the database name clearly
contains `"test"`:

- `ML_TEST_MONGO_CONN` — the test-database connection URI.
- `ML_TEST_MONGO_DB_NAME` — must contain `"test"` (e.g.
  `auth-db-ml-integration-test`).

If your `.env` already has a usable connection string under `MONGO_CONN`
(pointed at a cluster you're allowed to create a throwaway test database
on), you can load it into the current PowerShell session **without ever
printing it**:

```powershell
$mongoLine = Get-Content .env |
    Where-Object { $_ -match '^\s*MONGO_CONN\s*=' } |
    Select-Object -First 1

if (-not $mongoLine) {
    throw "MONGO_CONN was not found in .env"
}

$env:ML_TEST_MONGO_CONN = (($mongoLine -split '=', 2)[1]).Trim().Trim('"').Trim("'")
$env:ML_TEST_MONGO_DB_NAME = "auth-db-ml-integration-test"
```

Do not `Write-Host`/`echo` `$env:ML_TEST_MONGO_CONN` at any point, and never
commit a `.env`-derived value into a tracked file — this snippet only ever
touches the current, ephemeral shell session's environment.

Then run:

```powershell
python -m pytest tests\integration\test_mongo_repositories.py -v
```

A `ML_TEST_MONGO_DB_NAME` that is empty or missing `"test"` is the fixture
correctly failing closed, not a bug — see `real_test_db`'s own assertion.
