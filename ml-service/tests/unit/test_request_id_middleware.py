"""
[UNIT] OBS-001-T02 -- ml-service request/correlation ID middleware.

Exercises the real `request_id_middleware` coroutine defined in app.py
(imported via the shared `mocked_lifecycle_env` fixture -- see
test_lifecycle_mocked.py's module docstring for why only pymongo/bson/
fastapi/pydantic/joblib are faked, everything else is real production code).

Deliberately does NOT use `app_module.Request`/`app_module.Response`: which
class those names resolve to (the fake in fake_dependencies.py, or the real
Starlette one) depends on whether an earlier test in the same pytest
session already imported real fastapi (fake_dependencies.py only installs
its fake when "fastapi" is not already in sys.modules, so it never
shadows a real import). request_id_middleware only ever touches
`request.headers.get(...)`, `request.state.request_id`, and
`response.headers[...]` -- so this test builds minimal duck-typed
stand-ins for exactly that surface, which behave identically under either
resolution.
"""

import asyncio
import types

import pytest


class FakeHeaders(dict):
    def get(self, key, default=None):
        return dict.get(self, key, default)


class DuckRequest:
    def __init__(self, headers=None):
        self.headers = headers if headers is not None else FakeHeaders()
        self.state = types.SimpleNamespace()


class DuckResponse:
    def __init__(self):
        self.headers = {}


def _run(coro):
    return asyncio.run(coro)


def test_generates_a_request_id_when_none_supplied(mocked_lifecycle_env):
    ctx = mocked_lifecycle_env
    app_module = ctx.app_module

    request = DuckRequest()
    seen_request_id = {}

    async def fake_call_next(req):
        seen_request_id["value"] = req.state.request_id
        return DuckResponse()

    response = _run(app_module.request_id_middleware(request, fake_call_next))

    assert isinstance(seen_request_id["value"], str)
    assert len(seen_request_id["value"]) > 0
    assert response.headers[app_module.REQUEST_ID_HEADER] == seen_request_id["value"]


def test_reuses_a_well_shaped_incoming_request_id(mocked_lifecycle_env):
    ctx = mocked_lifecycle_env
    app_module = ctx.app_module

    request = DuckRequest(FakeHeaders({app_module.REQUEST_ID_HEADER: "client-req-123.abc_-"}))

    async def fake_call_next(req):
        return DuckResponse()

    response = _run(app_module.request_id_middleware(request, fake_call_next))

    assert request.state.request_id == "client-req-123.abc_-"
    assert response.headers[app_module.REQUEST_ID_HEADER] == "client-req-123.abc_-"


@pytest.mark.parametrize("malformed", ["has space", "with\nnewline", "<script>alert(1)</script>", "a" * 200])
def test_rejects_a_malformed_incoming_request_id(mocked_lifecycle_env, malformed):
    ctx = mocked_lifecycle_env
    app_module = ctx.app_module

    request = DuckRequest(FakeHeaders({app_module.REQUEST_ID_HEADER: malformed}))

    async def fake_call_next(req):
        return DuckResponse()

    _run(app_module.request_id_middleware(request, fake_call_next))

    assert request.state.request_id != malformed
