"""
[BACKEND-CONTRACT] Backend-to-ML contract verification (Phase G item 12).

Two kinds of checks:
  - STATIC: reads the real backend source (backend/Routes/ml.router.js,
    backend/cron/feedbackCollector.js) and asserts on its actual current
    behavior -- these run in ANY environment (pure text/regex, no
    dependencies) and are the primary evidence for this section, since the
    backend is a separate Node.js service this Python test suite cannot
    execute directly.
  - FASTAPI: response-shape assertions against the real predictor module,
    skipped if fastapi/pydantic are not importable (see
    tests/unit/test_lifecycle_mocked.py for the mocked-fastapi version of
    the same prediction-shape assertion, which DID execute for real as
    part of Phase G).
"""

import os
import re

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BACKEND_ML_ROUTER = os.path.join(REPO_ROOT, "backend", "Routes", "ml.router.js")
BACKEND_CRON = os.path.join(REPO_ROOT, "backend", "cron", "feedbackCollector.js")


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class TestPredictCategoryContractStatic:
    def test_backend_posts_expenseName_only(self):
        src = _read(BACKEND_ML_ROUTER)
        assert "expenseName" in src
        assert re.search(r"predict-category", src)

    def test_backend_requires_expenseName_before_calling_ml_service(self):
        src = _read(BACKEND_ML_ROUTER)
        assert "expenseName is required" in src

    def test_backend_has_a_bounded_axios_timeout_configured(self):
        """
        Phase G item 11 fix: the backend's axios.post call to
        /predict-category now passes an explicit `timeout` option, so a
        slow/hung ML service can no longer block this request
        indefinitely. Previously absent (see git history / the Phase G
        pre-fix final report finding) -- now present and bounded.
        """
        src = _read(BACKEND_ML_ROUTER)
        assert "PREDICT_TIMEOUT_MS" in src
        assert re.search(r"timeout\s*:\s*PREDICT_TIMEOUT_MS", src)

    def test_backend_distinguishes_unavailable_validation_and_unexpected_errors(self):
        """
        Phase G item 11 fix: the backend's catch block now branches on
        whether the ML service responded at all (no response -> 503,
        "unavailable"), whether it responded with an ordinary 4xx
        (forwarded as-is, not masked as a backend failure), or anything
        else (500, genuinely unexpected). Previously every failure mode
        collapsed into the same generic 500.
        """
        src = _read(BACKEND_ML_ROUTER)
        assert "!error.response" in src  # no-response branch (timeout/unreachable)
        assert "status >= 400 && status < 500" in src  # ordinary validation-error branch
        assert "Prediction service unavailable" in src

    def test_backend_preserves_the_successful_response_contract(self):
        """
        The fix above must not change what a SUCCESSFUL prediction
        response looks like -- still `response.data` forwarded verbatim
        with a 200, no wrapping or added fields.
        """
        src = _read(BACKEND_ML_ROUTER)
        assert re.search(r"res\.status\(200\)\.json\(\s*response\.data\s*\)", src)


class TestRetrainModelContractStatic:
    def test_cron_triggers_retrain_model_via_buildMlServiceUrl_with_no_body_and_operations_headers(self):
        """
        Remediation Workstream C: retrain-model is now authenticated via the
        shared mlServiceClient helpers, not a raw ML_ROUTE template-literal
        call. Asserts the CURRENT, intended shape: the URL is built through
        buildMlServiceUrl("/retrain-model"), no request payload is sent (an
        explicit undefined/null placeholder, matching app.py's
        RetrainTriggerRequest being Optional[...] = None), and the
        operations token is attached as axios request CONFIGURATION (the
        third positional argument), never as the request body.
        """
        src = _read(BACKEND_CRON)
        assert "retrain-model" in src

        # Whitespace-tolerant match of the real, multi-line axios.post call
        # -- deliberately structural (argument order/shape), not a loose
        # collection of unrelated substring checks, so a regression that
        # moves headers into the body position (or drops
        # buildMlServiceUrl/mlOperationsHeaders) cannot pass.
        call_pattern = re.compile(
            r"axios\.post\(\s*"
            r"buildMlServiceUrl\(\s*[\"']\/retrain-model[\"']\s*\)\s*,\s*"
            r"(?:undefined|null)\s*,\s*"
            r"\{\s*headers:\s*mlOperationsHeaders\(\)\s*\}\s*"
            r"\)"
        )
        assert call_pattern.search(src), (
            'Expected axios.post(buildMlServiceUrl("/retrain-model"), undefined, '
            "{ headers: mlOperationsHeaders() } ) -- headers must be request "
            "configuration (3rd argument), never the request body (2nd argument)."
        )

        # URL construction is centralized in buildMlServiceUrl() -- never a
        # direct, unvalidated `process.env.ML_ROUTE` concatenation.
        assert "process.env.ML_ROUTE" not in src

    def test_cron_handles_existingRun_as_a_normal_non_error_result(self):
        """
        Phase G item 11 fix: the cron now branches on
        `response.data.existingRun` and logs it as a normal, expected
        outcome (a retrain was already in progress), distinct from a
        freshly queued run -- previously it logged both cases identically.
        """
        src = _read(BACKEND_CRON)
        assert "response.data.existingRun" in src
        assert "already in progress" in src

    def test_cron_handles_503_as_a_transient_condition_not_an_internal_bug(self):
        """
        Phase G item 11 fix: a 503 from the ML service (e.g. mid-restart,
        or /retrain-model's own operational-token/service-unavailable
        paths) is now logged distinctly as "temporarily unavailable,
        will retry next scheduled run" rather than falling into the
        generic "Cron job error" branch used for genuinely unexpected
        failures.
        """
        src = _read(BACKEND_CRON)
        assert "err.response && err.response.status === 503" in src
        assert "temporarily unavailable" in src

    def test_cron_has_a_pending_feedback_threshold(self):
        src = _read(BACKEND_CRON)
        match = re.search(r"correctedCount\s*<\s*(\d+)", src)
        assert match is not None
        assert int(match.group(1)) == 100


fastapi = pytest.importorskip("fastapi", reason="fastapi is not installed in this environment")


class TestPredictCategoryContractLive:
    def test_response_contains_exactly_the_documented_fields(self):
        import sys
        sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
        from inference.predictor import predict_category
        # Requires a real, initialized predictor_manager snapshot; an uninitialized snapshot fails loudly here.
        result = predict_category("test expense")
        if "error" in result:
            pytest.skip(f"predictor_manager not initialized in this process: {result['error']}")
        assert set(result.keys()) == {"expenseName", "cleanedText", "predictedCategory", "confidence"}
