"""
Fake stand-ins for joblib/pymongo/bson/fastapi/pydantic/dotenv, used only by
`tests/conftest.py`'s `mocked_lifecycle_env` fixture.

CRITICAL (Phase G pytest-harness-isolation fix): nothing in this file has
any import-time side effect. Merely `import`ing this module must never
install anything into `sys.modules`. The previous design called an
`_install_fakes()` function unconditionally at `tests/conftest.py`'s own
module scope -- which pytest executes during test COLLECTION, before any
test (or fixture) actually runs, for every pytest invocation regardless of
which tests were selected. That silently replaced the real `joblib` module
with a fake one (`sys.modules.setdefault("joblib", fake_joblib)`) before
`tests/integration/test_real_training.py` ever got a chance to import the
real one, producing exactly the observed
`AttributeError: module 'joblib' has no attribute 'Parallel'` once
scikit-learn tried to use the (fake, real-joblib-shaped-but-not-actually-
real) module already sitting in `sys.modules`.

The fix: every function below only BUILDS fake module objects and returns
them -- it is the caller's (mocked_lifecycle_env's) responsibility to
install them into `sys.modules`, and ONLY via a `monkeypatch`/`patch.dict`
context that is guaranteed to undo the mutation the instant that one
fixture's test finishes, never before or after.
"""

import sys
import threading
import types


def make_fake_joblib():
    fake_joblib = types.ModuleType("joblib")
    fake_joblib.__version__ = "FAKE-1.0.0"
    fake_joblib.dump = lambda obj, path: __import__("pickle").dump(obj, open(path, "wb"))
    fake_joblib.load = lambda path: __import__("pickle").load(open(path, "rb"))
    return {"joblib": fake_joblib}


def make_fake_mongo_stack():
    fake_bson = types.ModuleType("bson")

    class FakeObjectId:
        def __init__(self, value=None):
            if value is None:
                import uuid
                value = uuid.uuid4().hex[:24]
            self._value = str(value)

        def __eq__(self, other):
            return str(self) == str(other)

        def __hash__(self):
            return hash(str(self))

        def __str__(self):
            return self._value

        def __repr__(self):
            return f"FakeObjectId({self._value!r})"

        def __lt__(self, other):
            return str(self) < str(other)

    fake_bson.ObjectId = FakeObjectId

    fake_bson_errors = types.ModuleType("bson.errors")

    class FakeInvalidId(Exception):
        pass

    fake_bson_errors.InvalidId = FakeInvalidId
    fake_bson.errors = fake_bson_errors

    fake_dotenv = types.ModuleType("dotenv")
    fake_dotenv.load_dotenv = lambda *a, **k: None

    fake_pymongo = types.ModuleType("pymongo")

    class FakeReturnDocument:
        BEFORE = "before"
        AFTER = "after"

    fake_pymongo.ReturnDocument = FakeReturnDocument

    class FakeMongoClient:
        def __init__(self, *a, **k):
            pass

    fake_pymongo.MongoClient = FakeMongoClient

    fake_pymongo_errors = types.ModuleType("pymongo.errors")

    class FakeDuplicateKeyError(Exception):
        pass

    fake_pymongo_errors.DuplicateKeyError = FakeDuplicateKeyError
    fake_pymongo.errors = fake_pymongo_errors

    return {
        "bson": fake_bson,
        "bson.errors": fake_bson_errors,
        "dotenv": fake_dotenv,
        "pymongo": fake_pymongo,
        "pymongo.errors": fake_pymongo_errors,
    }


def make_fake_fastapi_stack():
    fake_fastapi = types.ModuleType("fastapi")

    class FakeFastAPI:
        def __init__(self, *a, **k):
            self._startup_handlers = []

        def on_event(self, name):
            def decorator(fn):
                if name == "startup":
                    self._startup_handlers.append(fn)
                return fn
            return decorator

        def post(self, path):
            return lambda fn: fn

        def get(self, path):
            return lambda fn: fn

        def head(self, path):
            return lambda fn: fn

        # OBS-001 -- app.py registers a request-id middleware via
        # @app.middleware("http"). The fake only needs to preserve the
        # decorated function unchanged (same shape as post/get/head above);
        # nothing in the mocked-lifecycle test suite drives the ASGI
        # middleware chain itself, so no invocation behavior is faked here.
        def middleware(self, middleware_type):
            def decorator(fn):
                self._startup_handlers = self._startup_handlers  # no-op, keeps attribute stable
                return fn
            return decorator

    class FakeHTTPException(Exception):
        def __init__(self, status_code=500, detail=""):
            self.status_code = status_code
            self.detail = detail

    class FakeResponse:
        def __init__(self, status_code=200):
            self.status_code = status_code
            # OBS-001 -- request_id_middleware writes response.headers[...],
            # mirroring the real Starlette Response's mutable headers mapping.
            self.headers = {}

    # OBS-001 -- app.py type-hints its request-id middleware's parameter as
    # `Request`; the fake only needs to exist as an importable name (it is
    # never instantiated by the mocked-lifecycle test suite).
    class FakeRequest:
        def __init__(self, headers=None):
            self.headers = headers or {}
            self.state = types.SimpleNamespace()

    fake_fastapi.FastAPI = FakeFastAPI
    fake_fastapi.HTTPException = FakeHTTPException
    fake_fastapi.Response = FakeResponse
    fake_fastapi.Header = lambda default=None: default
    fake_fastapi.Request = FakeRequest

    fake_fastapi_responses = types.ModuleType("fastapi.responses")

    class FakeJSONResponse:
        def __init__(self, status_code=200, content=None):
            self.status_code = status_code
            self.content = content

    fake_fastapi_responses.JSONResponse = FakeJSONResponse
    fake_fastapi.responses = fake_fastapi_responses

    fake_pydantic = types.ModuleType("pydantic")

    class FakeBaseModel:
        pass

    fake_pydantic.BaseModel = FakeBaseModel

    return {
        "fastapi": fake_fastapi,
        "fastapi.responses": fake_fastapi_responses,
        "pydantic": fake_pydantic,
    }


def install_fake_dependencies(patch):
    """
    Installs fake joblib/pymongo/bson/dotenv/fastapi/pydantic into
    `sys.modules`, SCOPED to the given `patch` object (expected to be a
    pytest `monkeypatch` -- or `monkeypatch.context()` result -- exposing
    `setitem(dict, key, value)`), so every mutation this function makes is
    automatically undone the instant the caller's monkeypatch context
    exits. This is the ONLY place in the whole test suite allowed to
    install these fakes, and it must only ever be called from INSIDE a
    fixture (never at module import time -- see this module's own
    docstring for why that distinction is the entire point of this fix).

    Never shadows a REAL package that is already imported in this process
    -- each fake is only installed if the real name is not already present
    in `sys.modules`, so a real-dependency test that already imported the
    genuine package earlier in the same pytest session is never displaced.

    Returns the dict of {module_name: fake_module} actually installed
    (useful for assertions in tests that want to confirm what was faked).
    """
    installed = {}

    if "joblib" not in sys.modules:
        installed.update(make_fake_joblib())
    if "pymongo" not in sys.modules:
        installed.update(make_fake_mongo_stack())
    if "fastapi" not in sys.modules:
        installed.update(make_fake_fastapi_stack())

    for name, module in installed.items():
        patch.setitem(sys.modules, name, module)

    return installed


# Fake MongoDB collection/database -- not pickled, so kept here rather than in fake_ml_objects.py.
class FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __iter__(self):
        return iter(self._docs)

    def sort(self, spec):
        key, direction = spec[0]
        self._docs.sort(key=lambda d: d.get(key), reverse=(direction == -1))
        return self

    def limit(self, n):
        self._docs = self._docs[:n]
        return self


class FakeCollection:
    def __init__(self):
        self._docs = {}
        self._lock = threading.Lock()
        self._seq = 0

    def _next_id(self):
        """
        Full-suite order-contamination fix: the previous `f"id{self._seq:06d}"`
        (e.g. "id000001") is not a valid 24-character hex string, so it only
        ever worked against `FakeObjectId` (which accepts any string) --
        never against the REAL `bson.ObjectId`, which requires a 12-byte
        value (24 hex chars) and raises `InvalidId` otherwise. Whichever of
        the two `bson` modules happens to be the real one in `sys.modules`
        at call time (this suite's fakes are only installed if a real
        `bson`/`pymongo` isn't already imported -- see
        `install_fake_dependencies`) must accept this id, so it is built as
        a genuine, deterministic, zero-padded 24-hex-digit string.
        """
        self._seq += 1
        import bson
        return bson.ObjectId(f"{self._seq:024x}")

    def insert_one(self, doc):
        with self._lock:
            doc = dict(doc)
            doc["_id"] = doc.get("_id") or self._next_id()
            self._docs[str(doc["_id"])] = doc

            class R:
                inserted_id = doc["_id"]
            return R()

    def find_one(self, query, sort=None):
        with self._lock:
            matches = [d for d in self._docs.values() if self._matches(d, query)]
            if sort:
                key, direction = sort[0]
                matches.sort(key=lambda d: d.get(key), reverse=(direction == -1))
            return dict(matches[0]) if matches else None

    def find(self, query=None):
        query = query or {}
        with self._lock:
            matches = [dict(d) for d in self._docs.values() if self._matches(d, query)]
        return FakeCursor(matches)

    def update_one(self, query, update, upsert=False):
        with self._lock:
            for d in self._docs.values():
                if self._matches(d, query):
                    self._apply_update(d, update)

                    class R:
                        modified_count = 1
                    return R()
            if upsert:
                new_doc = {k: v for k, v in (query or {}).items() if not isinstance(v, dict)}
                new_doc["_id"] = new_doc.get("_id", self._next_id())
                self._apply_update(new_doc, update)
                self._docs[str(new_doc["_id"])] = new_doc

            class R:
                modified_count = 0
            return R()

    def update_many(self, query, update):
        with self._lock:
            count = 0
            for d in self._docs.values():
                if self._matches(d, query):
                    self._apply_update(d, update)
                    count += 1

            class R:
                modified_count = count
            return R()

    def find_one_and_update(self, query, update, return_document=None, upsert=False):
        with self._lock:
            for d in self._docs.values():
                if self._matches(d, query):
                    before = dict(d)
                    self._apply_update(d, update)
                    return dict(d) if return_document == "after" else before
            if upsert:
                new_doc = {k: v for k, v in (query or {}).items() if not isinstance(v, dict)}
                new_doc["_id"] = new_doc.get("_id", self._next_id())
                self._apply_update(new_doc, update)
                self._docs[str(new_doc["_id"])] = new_doc
                return dict(new_doc) if return_document == "after" else None
            return None

    def delete_one(self, query):
        with self._lock:
            for key, d in list(self._docs.items()):
                if self._matches(d, query):
                    del self._docs[key]
                    return

    def create_index(self, *a, **k):
        return "fake-index"

    def _matches(self, doc, query):
        for k, v in (query or {}).items():
            docval = doc.get(k)
            if isinstance(v, dict):
                if "$ne" in v and docval == v["$ne"]:
                    return False
                if "$lt" in v and not (docval is not None and docval < v["$lt"]):
                    return False
                if "$in" in v and docval not in v["$in"]:
                    return False
            elif docval != v:
                return False
        return True

    def _apply_update(self, doc, update):
        if "$set" in update:
            doc.update(update["$set"])
        if "$setOnInsert" in update:
            for k, v in update["$setOnInsert"].items():
                doc.setdefault(k, v)
        if "$inc" in update:
            for k, v in update["$inc"].items():
                doc[k] = (doc.get(k) or 0) + v


class FakeDB:
    def __init__(self):
        self._collections = {}

    def __getitem__(self, name):
        if name not in self._collections:
            self._collections[name] = FakeCollection()
        return self._collections[name]
