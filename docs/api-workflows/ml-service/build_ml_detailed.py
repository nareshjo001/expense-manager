"""
Level 2 detailed diagrams for the ML Service module — one file, nineteen outputs.

Every card is traced to source (see build_ml_overviews.py's own docstring for the
full file list). Nothing here draws a mechanism the repository doesn't have.

Run:  python3 build_ml_detailed.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from workflow_diagram import Diagram, load_tokens   # noqa: E402

T = load_tokens()
L, C = T["layout"], T["canvas"]
Y0, PITCH, CW = L["firstCardY"], L["cardPitch"], L["cardWidth"]
BW, BH, BY = L["bandCardWidth"], L["bandCardHeight"], 982
BX = [40, 309, 578, 847, 1116, 1385]
GUTTER = (894, 902, 910, 918, 926, 934)

FOOT = ("Heavy arrows are region hand-offs; the cyan one is the HTTP response. Light "
        "arrows are steps inside a region. Absent mechanisms are named in a note, "
        "never drawn as implemented steps.")


def base(title, subtitle, labels):
    d = Diagram(T, title=title, subtitle=subtitle)
    r = [d.region(x, w, lab, sub, accent=accent, step=i + 1)
         for i, (x, w, lab, sub, accent) in enumerate(labels)]
    return d, r


def col(region, i):
    return region.card_x, Y0 + i * PITCH


def stack(d, region, specs, start=0):
    made = []
    for i, sp in enumerate(specs):
        kind, icon, kicker, stage, impl, purpose = sp[:6]
        extra = sp[6] if len(sp) > 6 else {}
        made.append(d.card(*col(region, start + i), kind, icon, kicker, stage, impl,
                           purpose, **extra))
    for a, b in zip(made, made[1:]):
        d.flow_down(a, b)
    return made


def band(d, cards):
    d.exception_band(20, C["bandTop"], 1640, C["bandBottom"] - C["bandTop"],
                     "Exceptions and Current Limitations")
    return [d.exception_card(BX[i], BY, BW, BH, *c) for i, c in enumerate(cards)]


def finish(d, out, api_id, tail):
    svg = d.render(meta_right="BALENISA · Personal Finance Platform",
                   meta_left="docs/api-workflows · %s · Level 2 detailed" % api_id,
                   footer_notes=[FOOT, tail])
    destinations = {
        "ml-api-01": "health-head", "ml-api-02": "health",
        "ml-api-03": "health-live", "ml-api-04": "health-ready",
        "ml-api-05": "ml-status", "ml-api-06": "training-runs-list",
        "ml-api-07": "training-run", "ml-api-08": "predict-category",
        "ml-api-09": "generate-description", "ml-api-10": "retrain-model",
        "ml-flow-01": "flow/prediction", "ml-flow-02": "flow/startup-loading",
        "ml-flow-03": "flow/dataset-const", "ml-flow-04": "flow/training-eval",
        "ml-flow-05": "flow/validation-promotion", "ml-flow-06": "flow/persistence-activation",
        "ml-flow-07": "flow/retraining-lifecycle", "ml-flow-08": "startup-reconciliation",
        "ml-flow-09": "flow/backend-integration",
    }
    directory = next(destination for prefix, destination in destinations.items()
                     if out.startswith(prefix))
    path = os.path.join(HERE, directory, out)
    open(path, "w", encoding="utf-8").write(svg)
    print("wrote", os.path.relpath(path, HERE), len(svg))


def final_region(d, region, specs, note):
    made = stack(d, region, specs)
    ny = made[-1].bottom + 16
    nh = region.y + region.h - ny - 20
    d.note_box(region.card_x, ny, region.w - 2 * L["regionPaddingX"], max(nh, 120), *note)
    return made


# ===========================================================================
# ML-API-01 — HEAD /
# ===========================================================================
d, (r1, r2, r3) = base(
    "HEAD / — detailed implementation workflow",
    "Level 2 · real functions and modules · badges map to the 4 stages in "
    "ml-api-01-health-head-overview.svg",
    [(20, 400, "Caller", "No confirmed source in this repo", "frontend"),
     (444, 400, "FastAPI Routing", "app.head(\"/\")", "backend"),
     (888, 772, "Handler & Response", "No dependencies touched", "response")])

a = stack(d, r1, [
    ("frontend", "cursor", "REQUEST", "HEAD /", "any HTTP client",
     "No body possible for a HEAD request by definition.", {"step": "01"}),
])
b = stack(d, r2, [
    ("backend", "server", "ROUTING", "@app.head(\"/\")", "app.py:413",
     "Registered as its own route, distinct from GET /.", {"step": "02"}),
])
c = final_region(d, r3, [
    ("backend", "gears", "HANDLER", "health_head()", "return Response(status_code=200)",
     "No MongoDB, no predictor_manager, no body.", {"step": "03"}),
    ("response", "send", "RESPONSE", "200", "headers only",
     "HTTP forbids a body on a HEAD response regardless.", {"step": "04"}),
], ("No confirmed caller", [
    "No grep hit for a HEAD request to this service in backend/ or frontend/. "
    "Kept as its own API workflow because the binding rule counts every real "
    "endpoint regardless of whether a caller is confirmed.",
], "insights"))
d.handoff(a[-1], b[0], 439); d.handoff(b[-1], c[0], 883)

band(d, [
    ("E1", "No caller confirmed", "repo-wide grep", "Most plausibly an external uptime probe or load balancer, not something this repository's code confirms."),
])

finish(d, "ml-api-01-health-head-detailed.svg", "ML-API-01",
       "Distinct FastAPI route registration from GET / (ML-API-02) despite sharing a path.")


# ===========================================================================
# ML-API-02 — GET /
# ===========================================================================
d, (r1, r2, r3) = base(
    "GET / — detailed implementation workflow",
    "Level 2 · real functions and modules · badges map to the 5 stages in "
    "ml-api-02-health-overview.svg",
    [(20, 400, "Backend Caller", "server.js's own /ping route", "backend"),
     (444, 400, "FastAPI Routing & Handler", "app.get(\"/\")", "backend"),
     (888, 772, "Response & Backend Usage", "Feeds /ping's own body", "response")])

a = stack(d, r1, [
    ("backend", "server", "CALLER", "GET /ping", "backend/server.js:63",
     "await axios.get(`${ML_ROUTE}/`) — no timeout configured in this snippet.", {"step": "01"}),
])
b = stack(d, r2, [
    ("backend", "server", "ROUTING", "@app.get(\"/\")", "app.py:418",
     "Matched by path and method, ahead of any dependency.", {"step": "02"}),
    ("backend", "gears", "HANDLER", "health()", "return {\"status\": \"running\"}",
     "Static string — never reflects predictor or DB state.", {"step": "02"}),
])
c = final_region(d, r3, [
    ("response", "send", "RESPONSE", "200", "{\"status\": \"running\"}",
     "Body is fixed regardless of model readiness.", {"step": "03"}),
    ("backend", "monitor", "BACKEND USE", "ml: \"up\"/\"down\"", "server.js /ping",
     "A failure/timeout on this call flips /ping's own ml field to \"down\".", {"step": "04"}),
], ("Not a readiness signal", [
    "\"running\" only confirms the FastAPI process answered HTTP — it says "
    "nothing about whether a model is loaded. See ML-API-04 for the endpoint "
    "that actually checks readiness.",
], "error"))
d.handoff(a[-1], b[0], 439); d.handoff(b[-1], c[0], 883)

band(d, [
    ("E1", "No timeout visible on caller", "server.js:63", "The /ping handler's own axios.get call to this endpoint has no explicit timeout in the traced snippet."),
])

finish(d, "ml-api-02-health-detailed.svg", "ML-API-02",
       "The only ML-service endpoint confirmed to be called purely as a cross-service health signal.")


# ===========================================================================
# ML-API-03 — GET /health/live
# ===========================================================================
d, (r1, r2, r3) = base(
    "GET /health/live — detailed implementation workflow",
    "Level 2 · real functions and modules · badges map to the 4 stages in "
    "ml-api-03-health-live-overview.svg",
    [(20, 400, "Caller", "No confirmed production caller", "frontend"),
     (444, 400, "FastAPI Routing", "app.get(\"/health/live\")", "backend"),
     (888, 772, "Handler & Response", "status_api.build_liveness()", "response")])

a = stack(d, r1, [
    ("frontend", "cursor", "REQUEST", "GET /health/live", "no in-repo caller",
     "Exercised only by tests/integration/test_end_to_end_retraining.py.", {"step": "01"}),
])
b = stack(d, r2, [
    ("backend", "server", "ROUTING", "@app.get(\"/health/live\")", "app.py:446",
     "Registered before any MongoDB or predictor dependency.", {"step": "02"}),
])
c = final_region(d, r3, [
    ("backend", "gears", "HANDLER", "build_liveness()", "status_api.py:201",
     "Returns a fixed dict; never touches Mongo or predictor_manager by design.", {"step": "03"}),
    ("response", "send", "RESPONSE", "200", "{\"status\": \"alive\"}",
     "Always 200 — a DB outage or bad model must never fail liveness.", {"step": "04"}),
], ("No orchestrator wiring found", [
    "No Dockerfile HEALTHCHECK directive and no container-orchestration manifest "
    "exist in this repository that call this route — classified Externally "
    "reachable but unused / deployment-dependent.",
], "insights"))
d.handoff(a[-1], b[0], 439); d.handoff(b[-1], c[0], 883)

band(d, [
    ("E1", "Deliberately cannot fail", "status_api.py", "build_liveness performs zero I/O on purpose — it cannot distinguish a healthy process from one with a broken model."),
])

finish(d, "ml-api-03-health-live-detailed.svg", "ML-API-03",
       "Contrast with ML-API-04: liveness answers only 'is the process alive', never 'can it predict'.")


# ===========================================================================
# ML-API-04 — GET /health/ready
# ===========================================================================
d, (r1, r2, r3, r4) = base(
    "GET /health/ready — detailed implementation workflow",
    "Level 2 · real functions and modules · badges map to the 6 stages in "
    "ml-api-04-health-ready-overview.svg",
    [(20, 272, "Caller", "No confirmed production caller", "frontend"),
     (306, 272, "Routing", "app.get(\"/health/ready\")", "backend"),
     (592, 460, "Readiness Checks", "status_api.build_readiness()", "backend"),
     (1066, 594, "Decision & Response", "200 or 503", "response")])

a = stack(d, r1, [
    ("frontend", "cursor", "REQUEST", "GET /health/ready", "no in-repo caller",
     "Exercised only by the integration test suite.", {"step": "01"}),
])
b = stack(d, r2, [
    ("backend", "server", "ROUTING", "@app.get(\"/health/ready\")", "app.py:456",
     "Delegates immediately to status_api.build_readiness.", {"step": "02"}),
])
c = stack(d, r3, [
    ("backend", "database", "SNAPSHOT", "current_snapshot()", "None -> not ready",
     "First and cheapest check.", {"step": "03"}),
    ("backend", "gears", "STRUCTURE", "model/vectorizer/labelEncoder set", "practically unreachable",
     "RuntimeSnapshot's own constructor already guarantees this.", {"step": "03"}),
    ("backend", "bolt", "SMOKE TEST", "gate_smoke_predictions()", "4 fixed inputs",
     "In-memory only — no disk I/O, no manifest read, no reload.", {"step": "03"}),
])
e = final_region(d, r4, [
    ("response", "gears", "DECISION", "ready: bool, body: dict", "never raises",
     "route layer maps ready to the HTTP status code.", {"step": "04"}),
    ("response", "send", "RESPONSE", "200 or 503", "modelVersion on success",
     "A load balancer is expected to stop routing traffic on 503.", {"step": "05"}),
], ("No confirmed production caller", [
    "Same gap as ML-API-03 — implemented correctly, but nothing in this "
    "repository's backend, frontend, Dockerfile, or deployment config calls it.",
], "insights"))
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 1059)

band(d, [
    ("E1", "Smoke test failure -> 503", "smoke_test()", "A failing smoke prediction on the current snapshot is the one condition that can flip this endpoint to not-ready without a restart."),
])

finish(d, "ml-api-04-health-ready-detailed.svg", "ML-API-04",
       "The only endpoint that can genuinely say 'stop sending this process traffic'.")


# ===========================================================================
# ML-API-05 — GET /ml-status
# ===========================================================================
d, (r1, r2, r3, r4) = base(
    "GET /ml-status — detailed implementation workflow",
    "Level 2 · real functions and modules · badges map to the 6 stages in "
    "ml-api-05-ml-status-overview.svg",
    [(20, 272, "Caller", "No confirmed caller; token header required", "frontend"),
     (306, 272, "Operations-token Guard", "_require_operations_token", "auth"),
     (592, 460, "Status Assembly", "status_api.build_ml_status()", "backend"),
     (1066, 594, "Response", "Sanitized dict", "response")])

a = stack(d, r1, [
    ("frontend", "key", "REQUEST", "GET /ml-status", "X-ML-Operations-Token header",
     "No backend/frontend code sends this header anywhere in this repo.", {"step": "01"}),
])
b = stack(d, r2, [
    ("auth", "shield", "CONFIGURED?", "operations_token_configured()", "checks env presence",
     "Repo's .env has no ML_OPERATIONS_TOKEN -> 503 unconditionally.", {"step": "02", "tag": "E1"}),
    ("auth", "key", "COMPARE", "secrets.compare_digest", "constant-time",
     "Never reached with the current .env.", {"step": "02"}),
])
c = stack(d, r3, [
    ("backend", "gauge", "RUNTIME META", "current_snapshot_metadata()", "in-memory read",
     "modelVersion, runId, loadedAt, manifestGeneration.", {"step": "03"}),
    ("database", "file-text", "MANIFEST", "read_manifest()", "one file read",
     "Never triggers a reload by calling this endpoint.", {"step": "03"}),
    ("backend", "gears", "SYNCHRONIZED?", "runtime vs manifest compare", "bool",
     "True iff this process's snapshot matches the published manifest.", {"step": "03"}),
])
e = final_region(d, r4, [
    ("response", "send", "RESPONSE", "200, sanitized dict", "runtime + activeManifest + diagnostics",
     "Never a raw document dump — a fixed, hand-picked field set.", {"step": "04"}),
], ("Always 503 in the checked-out repo", [
    "operations_token_configured() is false because ML_OPERATIONS_TOKEN is "
    "unset in ml-service/.env — this endpoint cannot succeed against the "
    "repository's own current configuration without setting that variable.",
], "error"))
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 1059)

band(d, [
    ("E1", "Fails closed, never open", "_require_operations_token", "No 'operational endpoints are open by default' fallback exists — an unset token is always 503, never permissive."),
])

finish(d, "ml-api-05-ml-status-detailed.svg", "ML-API-05",
       "Classified Internal/testing endpoint: fully implemented, but unconfigured and uncalled here.")


# ===========================================================================
# ML-API-06 — GET /training-runs
# ===========================================================================
d, (r1, r2, r3, r4) = base(
    "GET /training-runs — detailed implementation workflow",
    "Level 2 · real functions and modules · badges map to the 6 stages in "
    "ml-api-06-training-runs-list-overview.svg",
    [(20, 272, "Caller", "No confirmed caller", "frontend"),
     (306, 272, "Token Guard", "same as ML-API-05", "auth"),
     (592, 460, "Query Assembly", "list_runs_response()", "database"),
     (1066, 594, "Response", "items + nextCursor", "response")])

a = stack(d, r1, [
    ("frontend", "key", "REQUEST", "GET /training-runs?limit&status&before", "X-ML-Operations-Token",
     "No dashboard or CLI in this repo consumes this endpoint.", {"step": "01"}),
])
b = stack(d, r2, [
    ("auth", "shield", "TOKEN GUARD", "_require_operations_token", "fail-closed 503",
     "Same guard, same unset-.env outcome as ML-API-05.", {"step": "02", "tag": "E1"}),
])
c = stack(d, r3, [
    ("backend", "gears", "PARAMS VALIDATED", "limit clamp [1,100]; status in ALLOWED_STATUSES", "400 on bad filter",
     "A malformed cursor also raises ValueError -> 400.", {"step": "03"}),
    ("database", "database", "BOUNDED QUERY", "find().sort().limit(n+1)", "no full scan, ever",
     "The +1 document only detects 'is there a next page'.", {"step": "03"}),
])
e = final_region(d, r4, [
    ("backend", "gears", "SERIALIZATION", "serialize_run_summary", "RUN_SUMMARY_FIELDS allow-list",
     "Narrower field set than the detail view (ML-API-07).", {"step": "04"}),
    ("response", "send", "RESPONSE", "200, items/count/nextCursor", "nextCursor is None on the last page",
     "Cursor = previous page's last runId, sorted by _id descending.", {"step": "05"}),
], ("No confirmed caller", [
    "Same operational-endpoint gap as ML-API-05 and ML-API-07 — implemented "
    "and reachable, but never invoked anywhere in this repository.",
], "insights"))
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 1059)

band(d, [
    ("E1", "Bad status/cursor -> 400", "list_runs()", "An unrecognized status filter or malformed cursor is rejected explicitly, never silently ignored or passed through to MongoDB unfiltered."),
])

finish(d, "ml-api-06-training-runs-list-detailed.svg", "ML-API-06",
       "Cursor pagination reuses MongoDB ObjectId ordering — no separate tie-breaker field needed.")


# ===========================================================================
# ML-API-07 — GET /training-runs/{run_id}
# ===========================================================================
d, (r1, r2, r3, r4) = base(
    "GET /training-runs/{run_id} — detailed implementation workflow",
    "Level 2 · real functions and modules · badges map to the 6 stages in "
    "ml-api-07-training-run-detail-overview.svg",
    [(20, 272, "Caller", "No confirmed caller", "frontend"),
     (306, 272, "Token Guard", "same as ML-API-05/06", "auth"),
     (592, 460, "Lookup & Serialization", "status_api.get_run_detail()", "database"),
     (1066, 594, "Response", "404 or full detail", "response")])

a = stack(d, r1, [
    ("frontend", "key", "REQUEST", "GET /training-runs/{run_id}", "X-ML-Operations-Token",
     "Same unwired operational surface as ML-API-05/06.", {"step": "01"}),
])
b = stack(d, r2, [
    ("auth", "shield", "TOKEN GUARD", "_require_operations_token", "fail-closed 503",
     "Identical guard, identical outcome given the repo's .env.", {"step": "02"}),
])
c = stack(d, r3, [
    ("database", "database", "GET RUN", "training_run_repository.get_run", "ObjectId(run_id)",
     "InvalidId caught and treated as \"not found\", never a 500.", {"step": "03", "tag": "E1"}),
    ("backend", "gears", "SERIALIZATION", "serialize_run_detail", "RUN_DETAIL_FIELDS allow-list",
     "Includes gates, metrics, activation metadata.", {"step": "03"}),
])
e = final_region(d, r4, [
    ("response", "alert", "404 PATH", "detail is None", "one code, two causes",
     "Bad run_id format and \"genuinely missing\" are indistinguishable on purpose.", {"step": "04"}),
    ("response", "send", "200 PATH", "full sanitized run document", "gates + metrics + activation",
     "Widest field set of any operational endpoint response.", {"step": "05"}),
], ("No confirmed caller", [
    "Same gap as ML-API-05/06 — implemented, reachable, never invoked in "
    "this repository's backend or frontend.",
], "insights"))
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 1059)

band(d, [
    ("E1", "404 hides MongoDB's own validation shape", "get_run()", "Deliberate — an external caller can never distinguish 'malformed id' from 'no such run' from the status code alone."),
])

finish(d, "ml-api-07-training-run-detail-detailed.svg", "ML-API-07",
       "A run's own failureReason field, not the HTTP status, is what distinguishes a failed run from a healthy one.")


# ===========================================================================
# ML-API-08 — POST /predict-category
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "POST /predict-category — detailed implementation workflow",
    "Level 2 · real functions and modules · badges map to the 7 stages in "
    "ml-api-08-predict-category-overview.svg",
    [(20, 272, "Frontend & Backend Proxy", "AddExpense.js -> ml.router.js", "frontend"),
     (306, 272, "Validation", "PredictionRequest", "backend"),
     (592, 272, "Snapshot & Preprocessing", "get_snapshot(), preprocess_text", "backend"),
     (878, 272, "Model Inference", "TF-IDF -> RandomForest", "backend"),
     (1164, 496, "Response", "predictedCategory + confidence", "response")])

a = stack(d, r1, [
    ("frontend", "cursor", "UI TRIGGER", "AddExpense.js", "500ms debounce, >= 3 chars",
     "Skips programmatic name changes.", {"step": "01"}),
    ("backend", "send", "BACKEND PROXY", "ml.router.js", "5000ms axios timeout",
     "verifyToken-gated on the backend's own side.", {"step": "01", "tag": "E1"}),
])
b = stack(d, r2, [
    ("backend", "gears", "PYDANTIC", "PredictionRequest", "expenseName: str, required",
     "FastAPI returns 422 automatically for a missing/wrong-typed field.", {"step": "02"}),
])
c = stack(d, r3, [
    ("database", "database", "SNAPSHOT", "predictor_manager.get_snapshot()", "throttled reload check",
     "None -> {\"error\": \"no model is currently loaded\"}, still HTTP 200.", {"step": "03", "tag": "E2"}),
    ("backend", "gears", "PREPROCESS", "preprocess_text()", "lower, strip non-alnum",
     "Empty/whitespace-only input becomes an empty cleaned string.", {"step": "03"}),
])
e = stack(d, r4, [
    ("backend", "bolt", "TF-IDF", "vectorizer.transform([cleaned])", "1000 max features",
     "Unseen tokens contribute nothing to the vector.", {"step": "04"}),
    ("backend", "gears", "PREDICT", "model.predict(vector)", "RandomForestClassifier",
     "One global, process-wide model — not per-user.", {"step": "04"}),
    ("backend", "sigma", "DECODE + CONFIDENCE", "inverse_transform, predict_proba", "max class prob * 100",
     "Can only emit a category the model was actually trained on.", {"step": "04"}),
])
grp = final_region(d, r5, [
    ("response", "send", "RESPONSE", "200 always", "expenseName, cleanedText, predictedCategory, confidence",
     "Internal exceptions are caught and returned as {\"error\": str(e)}, still 200.", {"step": "05"}),
], ("Backend forwards ML errors, doesn't mask all of them", [
    "ml.router.js DOES distinguish: no response (503), ML 4xx (forwarded as-is), "
    "anything else (500) — but a caught internal predictor exception returns "
    "200 with an error field, which the backend forwards as a 200 success.",
], "error"))
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871); d.handoff(e[-1], grp[0], 1157)

band(d, [
    ("E1", "5s bounded timeout", "ml.router.js:15", "Previously unset; a hung ML service could otherwise block the backend request indefinitely."),
    ("E2", "No model = soft failure", "predictor.py:33-37", "Only reachable if predictor_manager.initialize() never ran or fully failed — returns a 200 with an error field, not a 503."),
])

finish(d, "ml-api-08-predict-category-detailed.svg", "ML-API-08",
       "Model can change between two concurrent requests via get_snapshot()'s lazy multi-worker reload — see ML-FLOW-01.")


# ===========================================================================
# ML-API-09 — POST /generate-description
# ===========================================================================
d, (r1, r2, r3, r4) = base(
    "POST /generate-description — detailed implementation workflow",
    "Level 2 · real functions and modules · badges map to the 6 stages in "
    "ml-api-09-generate-description-overview.svg",
    [(20, 272, "Backend Caller", "addexpense.js, description blank only", "backend"),
     (306, 272, "Validation", "DescriptionRequest", "backend"),
     (592, 460, "Rule-based Generation", "no model involved", "backend"),
     (1066, 594, "Response & Fallback", "backend writes finalDescription", "response")])

a = stack(d, r1, [
    ("backend", "send", "BACKEND CALL", "addexpense.js:50-58", "5000ms axios timeout",
     "Only when expenseDescription is blank on the create-expense request.", {"step": "01"}),
])
b = stack(d, r2, [
    ("backend", "gears", "PYDANTIC", "DescriptionRequest", "expenseName, expenseCategory, expenseAmount",
     "All three required by the model.", {"step": "02"}),
])
c = stack(d, r3, [
    ("backend", "gears", "KEYWORD MATCH", "generate_keyword_description", "first substring match wins",
     "e.g. \"uber\" -> \"Cab ride\"; not a trained model.", {"step": "03"}),
    ("backend", "gears", "TEMPLATE FALLBACK", "random.choice(CATEGORY_TEMPLATES)", "only if no keyword matched",
     "15 category buckets, several templates each.", {"step": "03"}),
    ("backend", "sigma", "AMOUNT ENRICHMENT", "amount > 5000", "\"High-value \" prefix",
     "Silently skipped (try/except) on a non-numeric amount.", {"step": "03"}),
])
e = final_region(d, r4, [
    ("response", "send", "RESPONSE", "200, {description}", "single string",
     "Written into expenseDescription before newExpense.save().", {"step": "04"}),
], ("Fallback text discrepancy", [
    "On any exception, addexpense.js logs 'falling back to \"Others\"' but "
    "actually sets finalDescription = \"\" — the log message and the real "
    "fallback value disagree. Documented as a confirmed finding, not fixed.",
], "error"))
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 1059)

band(d, [
    ("E1", "No ML model touched at all", "descriptionGenerator.py", "Despite living in inference/, this endpoint never reads predictor_manager, MongoDB, or any joblib artifact."),
])

finish(d, "ml-api-09-generate-description-detailed.svg", "ML-API-09",
       "A failure here never blocks expense creation — addexpense.js catches it locally and proceeds.")


# ===========================================================================
# ML-API-10 — POST /retrain-model
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "POST /retrain-model — detailed implementation workflow",
    "Level 2 · real functions and modules · badges map to the 8 stages in "
    "ml-api-10-retrain-model-overview.svg",
    [(20, 272, "Cron Trigger", "feedbackCollector.js, daily 20:30", "backend"),
     (306, 272, "Fast-path Check", "peek_active_run()", "database"),
     (592, 272, "Run Creation & Lock", "create_run(), claim_or_reclaim()", "database"),
     (878, 272, "Background Start", "Thread(background_retrain)", "backend"),
     (1164, 496, "Response", "202 or 200", "response")])

a = stack(d, r1, [
    ("backend", "gauge", "THRESHOLD", "feedbackCollector.js", ">= 100 pending MlFeedback docs",
     "Below 100, the cron logs and returns without calling this endpoint.", {"step": "01"}),
])
b = stack(d, r2, [
    ("database", "gauge", "FAST PATH", "peek_active_run()", "non-mutating read",
     "A live, non-stale lock short-circuits before any record is created.", {"step": "02"}),
])
c = stack(d, r3, [
    ("database", "save", "RUN CREATED", "create_run()", "status: queued",
     "Only reached if no live run was found by the fast path.", {"step": "03"}),
    ("database", "key", "LOCK CLAIM", "claim_or_reclaim()", "atomic find_one_and_update",
     "May reclaim from a provably stale prior holder.", {"step": "03", "tag": "E1"}),
])
e = stack(d, r4, [
    ("backend", "gears", "THREAD STARTED", "Thread(target=background_retrain)", "daemon=True",
     "In-process; not a separate worker or task queue.", {"step": "04"}),
])
grp = final_region(d, r5, [
    ("response", "send", "202 PATH", "status: queued, existingRun: false", "genuinely new run",
     "The full ML-FLOW-07 pipeline has only just begun.", {"step": "05"}),
    ("response", "monitor", "200 PATH", "existingRun: true", "duplicate trigger, normal",
     "Cron's own 503/retry handling treats this as expected, not an error.", {"step": "06"}),
], ("Acceptance, not completion or promotion", [
    "Neither 202 nor 200 means training finished, validated, or activated — "
    "those outcomes are only visible later via ML-API-06/07 (unwired) or "
    "server logs. This endpoint only reports whether a run was accepted.",
], "error"))
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871); d.handoff(e[-1], grp[0], 1157)

band(d, [
    ("E1", "Stale lock reclaim is owner-checked", "reclaim_stale_lock()", "Filtered on the EXACT expected old runId + a stale heartbeat, atomically — two concurrent callers observing the same stale owner cannot both win."),
])

finish(d, "ml-api-10-retrain-model-detailed.svg", "ML-API-10",
       "A MongoDB outage before the lock is claimed returns 503 before any run record is left dangling.")


# ===========================================================================
# ML-FLOW-01 — Prediction pipeline
# ===========================================================================
d, (r1, r2, r3, r4) = base(
    "Prediction pipeline — detailed implementation workflow",
    "Level 2 · real functions and modules · badges map to the 7 stages in "
    "ml-flow-01-prediction-pipeline-overview.svg",
    [(20, 272, "Input", "Arbitrary expenseName string", "frontend"),
     (306, 460, "Snapshot Acquisition", "predictor_manager.get_snapshot()", "backend"),
     (780, 460, "Preprocessing & Inference", "TF-IDF -> RandomForest", "backend"),
     (1254, 406, "Output", "predictedCategory + confidence", "response")])

a = stack(d, r1, [
    ("frontend", "cursor", "RAW INPUT", "expenseName", "any string",
     "Empty, whitespace-only, unicode, very long — all accepted without rejection.", {"step": "01"}),
])
b = stack(d, r2, [
    ("backend", "database", "THROTTLE CHECK", "manifest-check interval", "5s default",
     "No disk I/O at all if the interval hasn't elapsed.", {"step": "02"}),
    ("database", "file-text", "MANIFEST GENERATION", "compared to loaded generation", "cheap read only if due",
     "Unchanged generation -> current snapshot returned immediately.", {"step": "02", "tag": "E1"}),
])
c = stack(d, r3, [
    ("backend", "gears", "CLEAN TEXT", "preprocess_text()", "lower, strip non-alnum, collapse ws",
     "Whitespace-only input becomes an empty string, never rejected.", {"step": "03"}),
    ("backend", "bolt", "TF-IDF TRANSFORM", "vectorizer.transform", "1000 max features",
     "Unseen tokens simply contribute zero weight.", {"step": "03"}),
    ("backend", "gears", "MODEL PREDICT", "model.predict(vector)", "RandomForestClassifier",
     "Deterministic given a fixed model and fixed input.", {"step": "03"}),
])
e = final_region(d, r4, [
    ("backend", "sigma", "DECODE + CONFIDENCE", "inverse_transform, max(predict_proba)*100", "rounded to 2dp",
     "Can only ever emit a label present in labelEncoder.classes_.", {"step": "04"}),
    ("response", "send", "RETURNED DICT", "expenseName, cleanedText, predictedCategory, confidence", "always this shape",
     "Any exception is caught and returned as {\"error\": str(e)} instead.", {"step": "05"}),
], ("Snapshot can change mid-flight across requests", [
    "get_snapshot()'s lazy reload means two concurrent /predict-category calls "
    "arriving around a manifest generation change can be served by two "
    "different models — never a torn/half-updated snapshot within one call.",
], "error"))
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 773); d.handoff(c[-1], e[0], 1247)

band(d, [
    ("E1", "Concurrent reload guard", "_reload_attempt_lock", "A non-blocking lock ensures at most one thread per process performs a reload; others fall through to the still-valid current snapshot for that call."),
    ("E2", "Not semantic understanding", "trainer.py", "TF-IDF + RandomForest is conventional text classification — confidence is the model's own max class probability, not a calibrated certainty."),
])

finish(d, "ml-flow-01-prediction-pipeline-detailed.svg", "ML-FLOW-01",
       "The only workflow that feeds ML-API-08 — generate-description (ML-API-09) never touches this pipeline.")


# ===========================================================================
# ML-FLOW-02 — Initial model loading & startup activation
# ===========================================================================
d, (r1, r2, r3, r4) = base(
    "Startup model loading — detailed implementation workflow",
    "Level 2 · real functions and modules · badges map to the 6 stages in "
    "ml-flow-02-startup-loading-overview.svg",
    [(20, 272, "Startup Entry", "FastAPI startup handlers, in order", "backend"),
     (306, 460, "Manifest-based Load", "predictor_manager.initialize()", "database"),
     (780, 460, "Legacy Fallback", "training/model.pkl etc.", "database"),
     (1254, 406, "Runtime Assignment", "self._snapshot", "response")])

a = stack(d, r1, [
    ("backend", "gears", "CONFIG VALIDATED", "run_and_log_startup_validation", "registered FIRST",
     "A fatal config error (bad MONGO_CONN/ML_MODEL_ROOT) aborts before this runs.", {"step": "01"}),
])
b = stack(d, r2, [
    ("database", "file-text", "MANIFEST READ", "model_bundle.read_manifest()", "None or a dict",
     "None is the normal pre-first-activation state, not an error.", {"step": "02"}),
    ("database", "database", "CANDIDATE LOAD", "_load_candidate()", "completeness + 3 runtime gates",
     "runId cross-check against the bundle's own metadata.json.", {"step": "02", "tag": "E1"}),
])
c = stack(d, r3, [
    ("backend", "gears", "LEGACY LOAD", "_load_legacy()", "model.pkl, vectorizer.pkl, labelEncoder.pkl",
     "Used when no manifest exists, or the candidate fails to activate.", {"step": "03"}),
    ("backend", "gears", "SAME 3 GATES", "_validate_pipeline()", "feature/encoder compat + smoke",
     "Legacy files get the identical runtime validation as any candidate.", {"step": "03"}),
])
e = final_region(d, r4, [
    ("backend", "save", "SNAPSHOT SET", "self._snapshot = snapshot", "one RuntimeSnapshot per process",
     "modelVersion = LEGACY_VERSION for the fallback path.", {"step": "04"}),
    ("response", "alert", "STARTUP OUTCOME", "continues, or ActivationError", "fails ONLY if both sources fail",
     "The one situation where failing loudly beats starting with nothing.", {"step": "05"}),
], ("Manifest is never auto-repaired here", [
    "A corrupt or unreadable active.json is logged and bypassed in favor of "
    "the legacy fallback — this function never rewrites or deletes it.",
], "error"))
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 773); d.handoff(c[-1], e[0], 1247)

band(d, [
    ("E1", "Per-process, independent", "predictor_manager.py", "Every worker/replica runs this sequence on its own against the same shared manifest file — there is no cross-process coordination at startup itself."),
])

finish(d, "ml-flow-02-startup-loading-detailed.svg", "ML-FLOW-02",
       "See ML-FLOW-01 for how other already-running workers later converge on a newly-activated model.")


# ===========================================================================
# ML-FLOW-03 — Training-data construction
# ===========================================================================
d, (r1, r2, r3, r4) = base(
    "Training-data construction — detailed implementation workflow",
    "Level 2 · real functions and modules · badges map to the 7 stages in "
    "ml-flow-03-dataset-construction-overview.svg",
    [(20, 272, "Reservation", "reserve_feedback_for_run()", "database"),
     (306, 460, "Row Validation", "_validate_feedback_doc()", "backend"),
     (780, 460, "Deduplication", "duplicate cap, deterministic sort", "backend"),
     (1254, 406, "Snapshot Write", "immutable CSV + SHA-256", "database")])

a = stack(d, r1, [
    ("database", "refresh", "RECONCILE FIRST", "reconcile_reserved_feedback", "recovers orphaned reservations",
     "Runs before this run reserves anything new.", {"step": "01"}),
    ("database", "key", "RESERVE PENDING", "reserve_pending_feedback()", "one atomic op per document",
     "No MongoDB multi-doc atomic update exists, so this loops safely.", {"step": "01"}),
])
b = stack(d, r2, [
    ("database", "database", "TRAINED READ", "get_trained_feedback()", "read-only, cumulative",
     "Never mutates 'trained' documents.", {"step": "02"}),
    ("backend", "gears", "VALIDATE ROWS", "_validate_feedback_doc()", "category_config.normalize_*",
     "Unrecognized category -> needs_review, not silently dropped.", {"step": "02", "tag": "E1"}),
])
c = stack(d, r3, [
    ("backend", "gears", "SORT DETERMINISTICALLY", "_sort_key()", "(name, category, createdAt, _id)",
     "Guarantees reproducible output given identical input data.", {"step": "03"}),
    ("backend", "gears", "CAP DUPLICATES", "DUPLICATE_CAP = 3", "env-configurable",
     "Caps identical (name, category) pairs so one correction can't dominate.", {"step": "03"}),
    ("backend", "sigma", "CONFLICTS COUNTED", "conflictCount", "not resolved",
     "Same name, multiple valid categories — both rows kept, no auto winner.", {"step": "03"}),
])
e = final_region(d, r4, [
    ("database", "save", "SNAPSHOT WRITTEN", "temp file + os.replace", "training/dataset/runs/<runId>/",
     "Immutable — build_snapshot_for_run refuses to overwrite an existing one.", {"step": "04"}),
    ("response", "sigma", "METADATA RETURNED", "sha256, rowCounts, rejectedReasons", "attached by app.py",
     "This module never writes to the training-run document itself.", {"step": "05"}),
], ("Cross-user pooling is confirmed, not assumed", [
    "All users' expenses (base dataset) and all users' feedback corrections "
    "are combined into ONE shared dataset — one user's correction can "
    "influence predictions for every other user's future expenses.",
], "error"))
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 773); d.handoff(c[-1], e[0], 1247)

band(d, [
    ("E1", "Invalid rows never silently vanish", "_validate_feedback_doc", "This run's own invalid reservations transition to needs_review with a specific reason — never retried forever, never dropped without a trace."),
])

finish(d, "ml-flow-03-dataset-construction-detailed.svg", "ML-FLOW-03",
       "Feeds directly into ML-FLOW-04 as the --dataset argument to the trainer.py subprocess.")


# ===========================================================================
# ML-FLOW-04 — Model training & evaluation
# ===========================================================================
d, (r1, r2, r3, r4) = base(
    "Model training & evaluation — detailed implementation workflow",
    "Level 2 · real functions and modules · badges map to the 7 stages in "
    "ml-flow-04-training-evaluation-overview.svg",
    [(20, 272, "Subprocess Launch", "trainer.py --dataset ...", "backend"),
     (306, 460, "Feature & Label Prep", "TF-IDF + LabelEncoder", "backend"),
     (780, 460, "Fit & Evaluate", "RandomForestClassifier", "backend"),
     (1254, 406, "Bundle Write", "model_bundle.write_bundle()", "database")])

a = stack(d, r1, [
    ("backend", "server", "SUBPROCESS", "retrain_pipeline._run_trainer", "separate Python process",
     "Non-zero exit or missing result file -> training-stage failure.", {"step": "01"}),
    ("backend", "database", "DATASET LOADED", "pd.read_csv(snapshot)", "required columns checked",
     "Missing expenseName/expenseCategory column fails the run immediately.", {"step": "01"}),
])
b = stack(d, r2, [
    ("backend", "gears", "TEXT + CATEGORY CLEANED", "category_config.CATEGORY_ALIASES", "shared with dataset_builder",
     "Same alias mapping — cannot silently drift between the two modules.", {"step": "02"}),
    ("backend", "bolt", "TF-IDF FIT", "vectorizer.fit_transform", "max_features=1000, fit fresh",
     "Never reused across runs — a brand-new vectorizer every time.", {"step": "02"}),
    ("backend", "sigma", "LABELS ENCODED", "LabelEncoder.fit_transform", "classes_ = new category set",
     "This becomes the candidate's own encoderClasses.", {"step": "02"}),
])
c = stack(d, r3, [
    ("backend", "gears", "SPLIT", "train_test_split, stratify=y, seed 42", "ValueError -> non-stratified fallback",
     "A class with < 2 members triggers the fallback.", {"step": "03", "tag": "E1"}),
    ("backend", "gears", "FIT", "RandomForestClassifier(n_estimators=30)", "random_state=42",
     "A training exception here is an unrecoverable failure — no bundle saved.", {"step": "03"}),
    ("backend", "sigma", "EVALUATE", "accuracy_score(y_test, y_pred)", "metrics = None on failure",
     "An evaluation exception does NOT stop bundle save below.", {"step": "03", "tag": "E2"}),
])
e = final_region(d, r4, [
    ("database", "save", "BUNDLE WRITTEN", "model_bundle.write_bundle()", "temp dir + os.rename",
     "Refuses to overwrite an existing model_version directory.", {"step": "04"}),
    ("response", "sigma", "RESULT FILE", "success, artifactPath, metrics, encoderClasses", "read back by retrain_pipeline.py",
     "success is False if metrics is None, even though the bundle still saved.", {"step": "05"}),
], ("Non-stratified fallback can leak near-duplicates", [
    "The fallback split has no de-duplication step of its own — a "
    "near-identical row (same/similar text, same label) can still end up in "
    "both the train and test split, inflating the reported accuracy.",
], "error"))
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 773); d.handoff(c[-1], e[0], 1247)

band(d, [
    ("E1", "Stratification can fail", "train_test_split", "Any class with fewer than 2 members makes sklearn's stratify=y raise ValueError — caught, falls back to a plain 80/20 split."),
    ("E2", "Bundle saved even on eval failure", "trainer.py:266-292", "validate_model.py's gate 6 (valid_metrics) is what actually rejects a bundle with no usable metrics — this module doesn't reject it itself."),
])

finish(d, "ml-flow-04-training-evaluation-detailed.svg", "ML-FLOW-04",
       "Runs in its own subprocess specifically so each stage boundary gives app.py a clean heartbeat point.")


# ===========================================================================
# ML-FLOW-05 — Validation & promotion decision
# ===========================================================================
d, (r1, r2, r3, r4) = base(
    "Validation gates — detailed implementation workflow",
    "Level 2 · real functions and modules · badges map to the 7 stages in "
    "ml-flow-05-validation-promotion-overview.svg",
    [(20, 272, "Subprocess Launch", "validate_model.py", "backend"),
     (306, 460, "Structural Gates 1-4", "completeness..encoder compat", "backend"),
     (780, 460, "Metric & Behavior Gates 5-8", "dataset consistency..smoke", "backend"),
     (1254, 406, "Category Gate & Result", "gate 9 + structured output", "database")])

a = stack(d, r1, [
    ("backend", "server", "SUBPROCESS", "retrain_pipeline._run_validator", "separate Python process",
     "Non-zero exit means validation could not run at all.", {"step": "01"}),
])
b = stack(d, r2, [
    ("backend", "gears", "GATE 1-2", "completeness, loadability", "is_bundle_complete + joblib.load",
     "Stop-at-first-failure — gates 3-9 recorded as skipped if these fail.", {"step": "02"}),
    ("backend", "gears", "GATE 3-4", "feature_compatibility, encoder_model_compatibility", "shape checks only",
     "Compares vocabulary/feature/class counts, not runtime behavior.", {"step": "02"}),
])
c = stack(d, r3, [
    ("backend", "sigma", "GATE 5", "dataset_metadata_consistency", "hash + rowCounts must match exactly",
     "Catches a stale or wrong dataset being silently used.", {"step": "03"}),
    ("backend", "gears", "GATE 6", "valid_metrics", "accuracy present, finite, in [0,1]",
     "Structural soundness only — not whether accuracy is GOOD.", {"step": "03"}),
    ("backend", "gauge", "GATE 7", "regression_threshold", "vs. the ACTIVE run's own accuracy",
     "Skipped (not passed/failed) on a first run with no baseline.", {"step": "03", "tag": "E1"}),
    ("backend", "bolt", "GATE 8", "smoke_predictions", "4 fixed inputs, end-to-end",
     "Checks the pipeline WORKS, not that it's accurate.", {"step": "03"}),
])
e = final_region(d, r4, [
    ("backend", "gears", "GATE 9", "category_set_comparison", "hard fail only on a MISSING category",
     "New categories appearing is never a failure — only disappearance is.", {"step": "04"}),
    ("database", "send", "RESULT FILE", "success, 9 gates (named, incl. skipped)", "read back by retrain_pipeline.py",
     "Exit code 0 regardless of pass/fail — caller reads result.success.", {"step": "05"}),
], ("Regression threshold default mismatch", [
    "The checked-out .env has no ML_MAX_ACCURACY_REGRESSION set. "
    ".env.example documents a default of 0.02, but validate_model.py's own "
    "_resolve_max_regression() fallback is actually 0.05 when unset — the "
    "two defaults disagree; the code's 0.05 is what actually runs.",
], "error"))
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 773); d.handoff(c[-1], e[0], 1247)

band(d, [
    ("E1", "Baseline is the ACTIVE run, not the latest", "app.py _fetch_baseline", "Deliberately sourced from active.json's own runId, never 'the latest completed run' — avoids comparing against an unrelated candidate that never activated."),
])

finish(d, "ml-flow-05-validation-promotion-detailed.svg", "ML-FLOW-05",
       "Passing all 9 gates means 'publishable' only — activation (ML-FLOW-06) is a separate, later decision.")


# ===========================================================================
# ML-FLOW-06 — Artifact persistence & atomic activation
# ===========================================================================
d, (r1, r2, r3, r4) = base(
    "Artifact persistence & activation — detailed implementation workflow",
    "Level 2 · real functions and modules · badges map to the 7 stages in "
    "ml-flow-06-persistence-activation-overview.svg",
    [(20, 272, "Preload", "predictor_manager.preload_candidate()", "backend"),
     (306, 460, "Manifest Publish", "model_bundle.write_manifest()", "database"),
     (780, 460, "Swap & Smoke Test", "swap_in(), smoke_test()", "backend"),
     (1254, 406, "Outcome", "activated or rolled back", "database")])

a = stack(d, r1, [
    ("backend", "database", "PRELOAD", "preload_candidate()", "load + 3 runtime gates",
     "Manifest and runtime are BOTH untouched if this step fails.", {"step": "01", "tag": "E1"}),
])
b = stack(d, r2, [
    ("database", "file-text", "BUILD MANIFEST", "build_manifest()", "generation = previous + 1",
     "Caller-supplied, safe because only one run holds the lock at a time.", {"step": "02"}),
    ("database", "save", "PUBLISH", "write_manifest()", "temp file + os.replace",
     "From this instant, OTHER workers could start their own reload attempt.", {"step": "02"}),
])
c = stack(d, r3, [
    ("backend", "refresh", "SWAP IN", "swap_in(candidate_snapshot)", "single attribute assignment",
     "GIL-atomic — a reader sees either the full old or full new snapshot.", {"step": "03"}),
    ("backend", "bolt", "SMOKE TEST", "smoke_test()", "on the now-live snapshot",
     "Final end-to-end confirmation after the swap, not before.", {"step": "03"}),
])
e = final_region(d, r4, [
    ("database", "gauge", "SUCCESS PATH", "mark_activated()", "run status: activated",
     "Only after preload, publish, swap AND smoke test all succeeded.", {"step": "04"}),
    ("response", "alert", "FAILURE PATH", "_rollback_manifest()", "restores previous snapshot THEN manifest",
     "Runtime is fixed first so this process is never left serving a mismatch.", {"step": "05"}),
], ("Database can outlive the artifact on disk", [
    "Nothing in this workflow prevents an operator from manually deleting a "
    "bundle directory that active.json still references — the next reload "
    "attempt against it would then fail with a clear, logged ActivationError.",
], "error"))
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 773); d.handoff(c[-1], e[0], 1247)

band(d, [
    ("E1", "Preload always precedes publish", "_attempt_activation", "The one invariant this whole workflow protects: active.json can never be published pointing at a bundle THIS process just proved it cannot load."),
])

finish(d, "ml-flow-06-persistence-activation-detailed.svg", "ML-FLOW-06",
       "Other workers/replicas pick up an activation lazily, via ML-FLOW-01's throttled generation check — not immediately.")


# ===========================================================================
# ML-FLOW-07 — Background retraining lifecycle (umbrella)
# ===========================================================================
d, (r1, r2, r3, r4) = base(
    "Background retraining lifecycle — detailed implementation workflow",
    "Level 2 · real functions and modules · badges map to the 8 stages in "
    "ml-flow-07-retraining-lifecycle-overview.svg",
    [(20, 272, "Thread Start", "background_retrain(run_id)", "backend"),
     (306, 460, "Pipeline (FLOW-03..06)", "reservation -> ... -> activation", "backend"),
     (780, 460, "Terminal Status", "6 possible outcomes", "database"),
     (1254, 406, "Cleanup & Lock Release", "model_cleanup, release_lock", "backend")])

a = stack(d, r1, [
    ("backend", "gears", "THREAD ENTRY", "background_retrain(run_id)", "daemon Thread, started by ML-API-10",
     "Owns lifecycle status writes end to end for this run.", {"step": "01"}),
    ("database", "database", "BASELINE FETCHED", "_fetch_baseline()", "active.json's own run, if any",
     "None/None on a first run — never invented.", {"step": "01"}),
])
b = stack(d, r2, [
    ("backend", "gears", "RESERVATION + SNAPSHOT", "ML-FLOW-03", "reserve_feedback_for_run, build_snapshot",
     "Failure here fails the run at stage 'reservation' or 'snapshot'.", {"step": "02"}),
    ("backend", "gears", "TRAIN + EVALUATE", "ML-FLOW-04", "trainer.py subprocess",
     "run status -> 'evaluating' the instant this stage completes.", {"step": "02"}),
    ("backend", "gears", "VALIDATE", "ML-FLOW-05", "validate_model.py subprocess",
     "9 gates; failure here -> failed_validation.", {"step": "02"}),
])
c = stack(d, r3, [
    ("database", "save", "CANDIDATE PERSISTED", "persist_model_candidate()", "whenever a bundle exists",
     "Recorded even for a rejected candidate, for inspection.", {"step": "03"}),
    ("backend", "bolt", "ACTIVATION ATTEMPTED", "ML-FLOW-06", "only if validation succeeded",
     "6 possible terminal statuses total across this whole lifecycle.", {"step": "03", "tag": "E1"}),
])
e = final_region(d, r4, [
    ("backend", "refresh", "CLEANUP", "model_cleanup.run_cleanup()", "best-effort, after terminal state",
     "A cleanup failure can never affect activation or feedback state.", {"step": "04"}),
    ("database", "key", "LOCK RELEASED", "release_lock()", "outer finally, owner-checked",
     "Only after the ENTIRE sequence — training through activation-or-rollback — is terminal.", {"step": "05"}),
], ("A hard process kill loses the thread silently", [
    "The MongoDB lock makes this safe ACROSS processes, but within one "
    "process this is an ordinary daemon Thread — a kill mid-run leaves no "
    "in-process trace; ML-FLOW-08's startup sweep is the only recovery path.",
], "error"))
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 773); d.handoff(c[-1], e[0], 1247)

band(d, [
    ("E1", "Six distinct terminal states", "training_run_repository.py", "activated / failed / failed_validation / failed_activation, plus the legacy 'completed' — never collapsed into one generic 'done'."),
])

finish(d, "ml-flow-07-retraining-lifecycle-detailed.svg", "ML-FLOW-07",
       "Documented as the umbrella lifecycle per the rules — does not replace the independent FLOW-03..06 detail.")


# ===========================================================================
# ML-FLOW-08 — Startup reconciliation
# ===========================================================================
d, (r1, r2, r3, r4) = base(
    "Startup reconciliation — detailed implementation workflow",
    "Level 2 · real functions and modules · badges map to the 7 stages in "
    "ml-flow-08-startup-reconciliation-overview.svg",
    [(20, 272, "Orphaned-run Sweep", "reconcile_orphaned_runs()", "database"),
     (306, 460, "Feedback Sweep", "reconcile_reserved_feedback()", "database"),
     (780, 460, "Activation-state Sweep", "3 cases, manifest-driven", "backend"),
     (1254, 406, "Summary", "structured, logged", "response")])

a = stack(d, r1, [
    ("database", "gauge", "STALE QUEUED", "createdAt older than threshold", "300s default",
     "Nothing legitimate takes this long from create_run() to 'running'.", {"step": "01"}),
    ("database", "gauge", "LOCK-MISMATCHED", "running/evaluating, wrong lock owner", "provably done, one way or another",
     "The lock has since moved on to a different run via stale reclaim.", {"step": "01"}),
])
b = stack(d, r2, [
    ("database", "refresh", "RESERVED SWEEP", "reconcile_reserved_feedback()", "per currently-reserved doc",
     "Untouched if trainingRunId is the CURRENT active lock holder.", {"step": "02", "tag": "E1"}),
])
c = stack(d, r3, [
    ("database", "file-text", "MANIFEST RE-READ", "read_manifest()", "ground truth, not a status field",
     "None on manifest-invalid, logged and treated as absent.", {"step": "03"}),
    ("backend", "gauge", "CASE 1: STUCK ACTIVATING", "_reconcile_activating_run", "manifest match + valid bundle -> activated",
     "Otherwise -> failed_activation, reservations released.", {"step": "03"}),
    ("backend", "gauge", "CASE 2 + 3", "leftover reserved feedback; pre-activation manifest match", "finalize or reconcile like case 1",
     "Covers both crash windows independently.", {"step": "03"}),
])
e = final_region(d, r4, [
    ("response", "monitor", "STRUCTURED SUMMARY", "run_reconciliation log event", "counts per sweep, never silent",
     "queuedRunsFailed, runningRunsFailed, activatingRunsRecovered, etc.", {"step": "04"}),
], ("Startup-only, never periodic", [
    "Nothing re-runs any of these three sweeps later — a crash that happens "
    "well after startup waits for the NEXT process restart to be recovered.",
], "error"))
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 773); d.handoff(c[-1], e[0], 1247)

band(d, [
    ("E1", "Stale-but-not-yet-failed left untouched", "reconcile_reserved_feedback", "A queued/running run that is stale but not yet formally failed by claim_or_reclaim is deliberately left alone here, to avoid two runs believing they own the same feedback."),
])

finish(d, "ml-flow-08-startup-reconciliation-detailed.svg", "ML-FLOW-08",
       "Every decision re-derives truth from the manifest and bundle files — never a bare MongoDB status field alone.")


# ===========================================================================
# ML-FLOW-09 — Backend-to-ML categorization integration
# ===========================================================================
d, (r1, r2, r3, r4) = base(
    "Backend <-> ML categorization integration — detailed implementation workflow",
    "Level 2 · real functions and modules · badges map to the 8 stages in "
    "ml-flow-09-backend-integration-overview.svg",
    [(20, 272, "Frontend Prediction Request", "AddExpense.js debounce", "frontend"),
     (306, 460, "Backend Proxy & Description", "ml.router.js, addexpense.js", "backend"),
     (780, 460, "Persistence & Feedback", "newExpense.save(), MlFeedbackModel", "database"),
     (1254, 406, "Retraining Trigger", "feedbackCollector.js cron", "backend")])

a = stack(d, r1, [
    ("frontend", "cursor", "DEBOUNCED TYPING", "AddExpense.js useEffect", "500ms, >= 3 chars",
     "Skips programmatic (non-user) name changes.", {"step": "01"}),
])
b = stack(d, r2, [
    ("backend", "send", "PREDICT PROXY", "POST /ml/predict-category", "verifyToken-gated, 5s timeout",
     "Forwards ML-API-08's response body verbatim on success.", {"step": "02", "tag": "E1"}),
    ("backend", "gears", "DESCRIPTION CALL", "addexpense.js", "only if description blank",
     "Calls ML-API-09; failure -> finalDescription = \"\", never blocks save.", {"step": "02"}),
])
c = stack(d, r3, [
    ("database", "save", "FEEDBACK WRITE", "MlFeedbackModel.save()", "status: pending if corrected",
     "deriveMlCorrection compares predicted vs. actually-saved category server-side.", {"step": "03"}),
    ("database", "save", "EXPENSE PERSISTED", "newExpense.save()", "always proceeds",
     "Never blocked by any ML call above failing.", {"step": "03"}),
])
e = final_region(d, r4, [
    ("backend", "gauge", "CRON THRESHOLD", "feedbackCollector.js, daily 20:30", ">= 100 status: pending docs",
     "Counts status, not the legacy 'corrected' boolean.", {"step": "04"}),
    ("backend", "send", "RETRAIN CALL", "POST /retrain-model", "no request body, no timeout set",
     "Feeds directly into ML-API-10 and then ML-FLOW-07.", {"step": "05"}),
], ("Protected ML calls require the operations token", [
    "The backend sends X-ML-Operations-Token for predict-category, generate-description, "
    "retrain-model, and spending forecast. The /ping health probe remains unauthenticated.",
], "error"))
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 773); d.handoff(c[-1], e[0], 1247)

band(d, [
    ("E1", "Prediction is pre-submission only", "AddExpense.js", "The backend's own addExpense controller never calls /predict-category itself — only the frontend does, before the user submits; category prediction never gates persistence."),
])

finish(d, "ml-flow-09-backend-integration-detailed.svg", "ML-FLOW-09",
       "Spans Node.js and Python/FastAPI without introducing any new HTTP endpoint of its own, per the rules.")
