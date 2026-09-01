"""
Level 1 overviews for the ML Service module — one file, nineteen outputs.

Ten confirmed HTTP endpoints (every real FastAPI route gets its own API workflow,
per the binding classification rule — including HEAD /, GET /health/live and
GET /health/ready, none of which has a confirmed caller in this repository) plus
nine internal/combined flows covering the prediction pipeline, startup model
loading, training-data construction, training+evaluation, validation+promotion,
artifact persistence+activation, the background retraining lifecycle as a whole,
startup reconciliation, and the backend<->ML categorization integration.

Every card is traced to source: ml-service/app.py, status_api.py, observability.py,
config.py, inference/predictor.py, inference/predictor_manager.py,
inference/descriptionGenerator.py, training/dataset_builder.py, training/trainer.py,
training/model_validation.py, training/model_bundle.py, training/retrain_pipeline.py,
training/model_cleanup.py, training/category_config.py, db/training_run_repository.py,
db/feedback_repository.py, db/mongo.py, and on the backend side
backend/Routes/ml.router.js, backend/Controllers/ExpenseControllers/addexpense.js,
backend/cron/feedbackCollector.js, backend/config/Schemas.js (MlFeedbackSchema),
backend/server.js, and frontend/src/components/expensesHandling/AddExpense.js.

Nothing here draws a mechanism the repository doesn't have: no scheduler for
retraining (it is cron-in-the-Node-backend + manual, never an ML-service-internal
scheduler), no message queue, no model registry, no online learning, no
user-specific models, and no fixed category count (the label set is
whatever training/category_config.py's CANONICAL_CATEGORIES currently is).

Run:  python3 build_ml_overviews.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from workflow_diagram import Overview, load_tokens   # noqa: E402


def new(title, subtitle):
    return Overview(load_tokens(), title=title, subtitle=subtitle)


def error_card(o, x, y, w, title, lines):
    d, ep = o.d, o.d.pal("error")
    body = "".join(d._text(x + 13, y + 44 + i * 13, ln, 9.8, d.n["inkMuted"], 400)
                   for i, ln in enumerate(lines))
    d.mid.append('<g><rect x="%d" y="%d" width="%d" height="%d" rx="10" fill="%s" '
                 'stroke="%s" stroke-width="1" stroke-dasharray="4 3"/>%s%s%s</g>'
                 % (x, y, w, 34 + len(lines) * 13 + 12, ep["fill"], ep["border"],
                    d._icon("alert", x + 13, y + 12, ep["line"], 0.78),
                    d._text(x + 34, y + 25, title, 10.8, ep["ink"], 700), body))


def save(o, svg, name):
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
                     if name.startswith(prefix))
    path = os.path.join(HERE, directory, name)
    open(path, "w", encoding="utf-8").write(svg)
    print("wrote", os.path.relpath(path, HERE), len(svg))


def tail_error(o, t, idx, title, lines):
    error_card(o, o.COL[8], 460, o.CW, title, lines)
    o.d.path([(t[idx].right, o.R1_CY), (1584, o.R1_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
              "error", dashed=True)


# ===========================================================================
# ML-API-01 — HEAD /
# ===========================================================================
o = new("HEAD / — bare liveness ping",
        "Quick overview · follow 01 → 04 · full detail in ml-api-01-health-head-detailed.svg")
d, R1 = o.d, o.ROW1
d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "HEAD /",                                              "auth"),
    ("Handler",    "health_head() — returns Response(status_code=200)",   "backend"),
    ("Body",       "None — HEAD never returns a body by HTTP definition", "insights"),
    ("Confirmed caller", "None found in backend/ or frontend/",           "error"),
    ("Auth",       "None — completely open",                              "error"),
])
d.note_box(882, 276, 516, 168, "Unable to confirm the caller", [
    "No grep hit for a HEAD request to this service anywhere in backend/ or "
    "frontend/. Most plausibly an uptime-monitor or load-balancer probe "
    "configured outside this repository — not something the code confirms.",
], "insights")
t = [
    o.card(0, R1, "frontend", "cursor", "01", "HEAD Request", "any client",
           "No request body possible for HEAD."),
    o.card(1, R1, "backend", "server", "02", "FastAPI Routing", "app.head(\"/\")",
           "Matched before any other handler."),
    o.card(2, R1, "backend", "gears", "03", "Handler Runs", "health_head()",
           "No MongoDB, no predictor manager touched."),
    o.card(3, R1, "response", "send", "04", "200, No Body", "Response(status_code=200)",
           "Headers only, by HTTP's own HEAD semantics."),
]
o.chain(t, o.R1_CY)
tail_error(o, t, 3, "No confirmed caller",
           ["Kept because it is a real,", "reachable route — the binding", "rule counts it regardless."])
save(o, o.render(["Distinct from GET / (ML-API-02) — FastAPI treats HEAD and GET on the same "
                  "path as two separate route registrations, each independently reachable."],
                 "ML-API-01"),
     "ml-api-01-health-head-overview.svg")


# ===========================================================================
# ML-API-02 — GET /
# ===========================================================================
o = new("GET / — plain status string",
        "Quick overview · follow 01 → 05 · full detail in ml-api-02-health-detailed.svg")
d, R1 = o.d, o.ROW1
d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "GET /",                                               "auth"),
    ("Response",   "{\"status\": \"running\"}",                          "backend"),
    ("Confirmed caller", "backend/server.js's own GET /ping route",       "insights"),
    ("Timeout on caller", "None visible in the /ping handler",            "error"),
    ("Auth",       "None",                                                "error"),
])
d.note_box(882, 276, 516, 168, "Backend uses it as a dependency check", [
    "The Node backend's own /ping diagnostic calls this exact route to decide "
    "whether to report ml: \"up\" or \"down\" — the ML service's simplest "
    "endpoint doubles as the backend's cross-service health signal.",
], "insights")
t = [
    o.card(0, R1, "backend", "server", "01", "Backend /ping", "server.js",
           "axios.get(`${ML_ROUTE}/`)."),
    o.card(1, R1, "backend", "server", "02", "FastAPI Routing", "app.get(\"/\")",
           "Matched by path and method."),
    o.card(2, R1, "backend", "gears", "03", "Handler Runs", "health()",
           "No MongoDB, no predictor manager touched."),
    o.card(3, R1, "response", "send", "04", "200 OK", "{\"status\": \"running\"}",
           "Static string — never reflects model readiness."),
    o.card(4, R1, "backend", "monitor", "05", "Backend /ping Response", "ml: \"up\"",
           "Or \"down\" on any error/timeout from this call."),
]
o.chain(t, o.R1_CY)
tail_error(o, t, 4, "Not a readiness signal",
           ["\"running\" only means the", "process answered HTTP — see", "ML-API-04 for real readiness."])
save(o, o.render(["This is the only ML-service endpoint confirmed to be called by the Node "
                  "backend purely as a health signal, not for any business data."],
                 "ML-API-02"),
     "ml-api-02-health-overview.svg")


# ===========================================================================
# ML-API-03 — GET /health/live
# ===========================================================================
o = new("GET /health/live — liveness probe",
        "Quick overview · follow 01 → 04 · full detail in ml-api-03-health-live-detailed.svg")
d, R1 = o.d, o.ROW1
d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "GET /health/live",                                    "auth"),
    ("Touches",    "Nothing — no MongoDB, no predictor manager",          "backend"),
    ("Confirmed caller", "None in backend/ or frontend/; used only by tests", "error"),
    ("Orchestrator wiring", "No Dockerfile HEALTHCHECK, no k8s manifest in this repo", "error"),
])
d.note_box(882, 276, 516, 168, "Deliberately trivial by design", [
    "status_api.build_liveness() is documented to never touch Mongo or the "
    "predictor — a DB outage or bad model must never make liveness fail; "
    "that is readiness's job (ML-API-04).",
], "insights")
t = [
    o.card(0, R1, "frontend", "cursor", "01", "GET Request", "no confirmed caller",
           "Reachable, but nothing in-repo calls it."),
    o.card(1, R1, "backend", "server", "02", "FastAPI Routing", "app.get(\"/health/live\")",
           "Matched before any dependency check."),
    o.card(2, R1, "backend", "gears", "03", "build_liveness()", "status_api.py",
           "Returns a fixed dict, no I/O at all."),
    o.card(3, R1, "response", "send", "04", "200, {\"status\":\"alive\"}", "always 200",
           "Never a non-2xx — that would defeat the point of liveness."),
]
o.chain(t, o.R1_CY)
tail_error(o, t, 3, "No confirmed orchestrator wiring",
           ["A container platform would", "normally call this — none is", "configured inside this repo."])
save(o, o.render(["Exercised directly by tests/integration/test_end_to_end_retraining.py, "
                  "which is test coverage, not a production caller."],
                 "ML-API-03"),
     "ml-api-03-health-live-overview.svg")


# ===========================================================================
# ML-API-04 — GET /health/ready
# ===========================================================================
o = new("GET /health/ready — can this process predict right now",
        "Quick overview · follow 01 → 06 · full detail in ml-api-04-health-ready-detailed.svg")
d, R1 = o.d, o.ROW1
d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "GET /health/ready",                                   "auth"),
    ("Checks",     "Snapshot exists, is structurally complete, smoke-predicts", "backend"),
    ("Non-2xx on not-ready", "503, body echoes the specific reason",      "error"),
    ("Confirmed caller", "None in backend/ or frontend/; used only by tests", "error"),
])
d.note_box(882, 276, 516, 168, "A real end-to-end check, still cheap", [
    "The smoke test only exercises already-loaded in-memory objects on a few "
    "fixed strings — no disk I/O, no manifest read, no reload triggered by "
    "calling this endpoint.",
], "insights")
t = [
    o.card(0, R1, "backend", "database", "01", "Snapshot Exists?", "current_snapshot()",
           "None -> not ready, no further checks."),
    o.card(1, R1, "backend", "gears", "02", "Structural Check", "model/vectorizer/encoder set",
           "Practically unreachable given the constructor."),
    o.card(2, R1, "backend", "bolt", "03", "Smoke Prediction", "gate_smoke_predictions()",
           "4 fixed inputs through the live pipeline."),
    o.card(3, R1, "backend", "gears", "04", "Ready Decision", "ok, reason",
           "Never raises — always a structured (bool, dict)."),
    o.card(4, R1, "response", "send", "05", "200 or 503", "ready: true/false",
           "A load balancer is expected to stop routing on 503."),
    o.card(5, R1, "response", "monitor", "06", "modelVersion Echoed", "on success only",
           "Lets a caller confirm which candidate answered."),
]
o.chain(t, o.R1_CY)
tail_error(o, t, 5, "No confirmed production caller",
           ["Same gap as GET /health/live", "— nothing in this repo wires", "an orchestrator to call it."])
save(o, o.render(["Distinct from ML-API-02's static string: this is the one endpoint that can "
                  "genuinely say \"do not send this process traffic right now\"."],
                 "ML-API-04"),
     "ml-api-04-health-ready-overview.svg")


# ===========================================================================
# ML-API-05 — GET /ml-status
# ===========================================================================
o = new("GET /ml-status — sanitized runtime + manifest snapshot",
        "Quick overview · follow 01 → 06 · full detail in ml-api-05-ml-status-detailed.svg")
d, R1 = o.d, o.ROW1
d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "GET /ml-status",                                      "auth"),
    ("Auth",       "X-ML-Operations-Token, constant-time compare",        "auth"),
    ("Actual .env in this repo", "ML_OPERATIONS_TOKEN is unset — always 503", "error"),
    ("Read-only",  "Never triggers a reload — metadata + manifest reads only", "backend"),
])
d.note_box(882, 276, 516, 168, "Fails closed, not open, by default", [
    "operations_token_configured() is false whenever ML_OPERATIONS_TOKEN is "
    "unset — the confirmed .env in this repo has no such variable, so this "
    "endpoint is unconditionally 503 in the checked-out configuration.",
], "error")
t = [
    o.card(0, R1, "frontend", "key", "01", "Request + Header", "X-ML-Operations-Token",
           "No confirmed caller — no backend/frontend code sends this header."),
    o.card(1, R1, "auth", "shield", "02", "Token Configured?", "_require_operations_token",
           "Unset in this repo's .env -> 503 immediately."),
    o.card(2, R1, "auth", "key", "03", "Token Compared", "secrets.compare_digest",
           "Constant-time; never reached with the current .env."),
    o.card(3, R1, "backend", "gauge", "04", "Snapshot Metadata Read", "current_snapshot_metadata()",
           "In-memory only, no disk I/O."),
    o.card(4, R1, "database", "file-text", "05", "Manifest Read", "read_manifest()",
           "One file read; no reload triggered."),
    o.card(5, R1, "response", "send", "06", "200, sanitized dict", "runtime + activeManifest",
           "synchronized flag compares the two."),
]
o.chain(t, o.R1_CY)
tail_error(o, t, 1, "Currently always 503 in this repo",
           ["No caller could succeed against", "the checked-out .env without", "first setting the token."])
save(o, o.render(["Classified Internal/testing endpoint: reachable and fully implemented, but "
                  "unconfigured and uncalled in the current repository state."],
                 "ML-API-05"),
     "ml-api-05-ml-status-overview.svg")


# ===========================================================================
# ML-API-06 — GET /training-runs
# ===========================================================================
o = new("GET /training-runs — bounded, sorted run listing",
        "Quick overview · follow 01 → 06 · full detail in ml-api-06-training-runs-list-detailed.svg")
d, R1 = o.d, o.ROW1
d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "GET /training-runs?limit&status&before",              "auth"),
    ("Auth",       "Same operations token as ML-API-05",                  "auth"),
    ("Limit clamp", "[1, 100] regardless of what is requested",           "backend"),
    ("Bad status/cursor", "400, not silently ignored",                    "error"),
])
d.note_box(882, 276, 516, 168, "Cursor-paginated by design", [
    "\"before\" is the previous page's last runId; sorting is by _id "
    "descending, which doubles as newest-first without a second field.",
], "insights")
t = [
    o.card(0, R1, "frontend", "key", "01", "Request + Header", "X-ML-Operations-Token",
           "No confirmed caller in backend/ or frontend/."),
    o.card(1, R1, "auth", "shield", "02", "Token Guard", "_require_operations_token",
           "Same fail-closed 503 as ML-API-05."),
    o.card(2, R1, "backend", "gears", "03", "Filter Validated", "status in ALLOWED_STATUSES",
           "ValueError -> 400, not a silent no-op filter."),
    o.card(3, R1, "database", "database", "04", "Bounded Query", "list_runs()",
           "limit+1 documents fetched, never a full scan."),
    o.card(4, R1, "backend", "gears", "05", "Serialization", "serialize_run_summary",
           "Fixed field allow-list, never a raw doc dump."),
    o.card(5, R1, "response", "send", "06", "200, items + nextCursor", "count included",
           "nextCursor is None on the last page."),
]
o.chain(t, o.R1_CY)
tail_error(o, t, 1, "No confirmed caller",
           ["Same operational-endpoint gap", "as /ml-status — implemented,", "unwired, unconfigured token."])
save(o, o.render(["No dashboard or CLI in this repository consumes this endpoint — it exists "
                  "purely as an operator-facing API surface."],
                 "ML-API-06"),
     "ml-api-06-training-runs-list-overview.svg")


# ===========================================================================
# ML-API-07 — GET /training-runs/{run_id}
# ===========================================================================
o = new("GET /training-runs/{run_id} — one run's sanitized detail",
        "Quick overview · follow 01 → 06 · full detail in ml-api-07-training-run-detail-detailed.svg")
d, R1 = o.d, o.ROW1
d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "GET /training-runs/{run_id}",                          "auth"),
    ("Auth",       "Same operations token as ML-API-05/06",                "auth"),
    ("404 policy", "Bad ObjectId AND \"not found\" both return 404",       "backend"),
    ("Fields returned", "RUN_DETAIL_FIELDS allow-list, includes gates/metrics", "backend"),
])
d.note_box(882, 276, 516, 168, "Never distinguishes the two 404 causes", [
    "A malformed run_id and a genuinely missing run both produce the same "
    "404 — deliberate, so MongoDB's own ObjectId validation shape is never "
    "leaked to an external caller.",
], "insights")
t = [
    o.card(0, R1, "frontend", "key", "01", "Request + Header", "X-ML-Operations-Token",
           "No confirmed caller."),
    o.card(1, R1, "auth", "shield", "02", "Token Guard", "_require_operations_token",
           "Same fail-closed 503."),
    o.card(2, R1, "database", "database", "03", "get_run(run_id)", "ObjectId(run_id)",
           "InvalidId is caught, treated as \"not found\"."),
    o.card(3, R1, "backend", "gears", "04", "Serialization", "serialize_run_detail",
           "Wider field set than the list view."),
    o.card(4, R1, "response", "alert", "05", "404 if None", "one code, two causes",
           "Bad id or missing run — indistinguishable on purpose."),
    o.card(5, R1, "response", "send", "06", "200, full run detail", "gates, metrics, activation",
           "Everything status_api considers safe to expose."),
]
o.chain(t, o.R1_CY)
tail_error(o, t, 1, "No confirmed caller",
           ["Same as ML-API-05/06 —", "implemented, reachable,", "never invoked in this repo."])
save(o, o.render(["Distinguishes 'training run failed' from 'training run does not exist' "
                  "only via the response body's own failureReason field, not via status code."],
                 "ML-API-07"),
     "ml-api-07-training-run-detail-overview.svg")


# ===========================================================================
# ML-API-08 — POST /predict-category
# ===========================================================================
o = new("POST /predict-category — classifying one expense description",
        "Quick overview · follow 01 → 07 · full detail in ml-api-08-predict-category-detailed.svg")
d, R1 = o.d, o.ROW1
d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "POST /predict-category",                              "auth"),
    ("Confirmed caller", "backend/Routes/ml.router.js, 5 s timeout",      "insights"),
    ("Model scope", "One process-wide model, not per-user",               "backend"),
    ("Auth on this route", "None — open if reached directly",             "error"),
])
d.note_box(882, 276, 516, 168, "Bare-word errors, not HTTP errors", [
    "predict_category() catches every exception internally and returns "
    "{\"error\": str(e)} with a 200 status — the backend never sees a "
    "non-2xx from a genuine prediction-pipeline failure.",
], "error")
t = [
    o.card(0, R1, "backend", "send", "01", "Backend Proxy", "ml.router.js",
           "5 s axios timeout, verifyToken-gated on the backend side."),
    o.card(1, R1, "backend", "gears", "02", "Pydantic Validation", "PredictionRequest",
           "expenseName: str, required."),
    o.card(2, R1, "backend", "database", "03", "Snapshot Fetched", "predictor_manager.get_snapshot()",
           "None -> {\"error\": \"no model is currently loaded\"}."),
    o.card(3, R1, "backend", "gears", "04", "Text Cleaned", "preprocess_text()",
           "lower, strip non-alphanumeric, collapse whitespace."),
    o.card(4, R1, "backend", "bolt", "05", "Vectorize + Predict", "TF-IDF -> RandomForest",
           "Conventional text classification, not semantic understanding."),
    o.card(5, R1, "backend", "sigma", "06", "Confidence Computed", "max(predict_proba) * 100",
           "Meaningful only insofar as the forest's own probabilities are."),
    o.card(6, R1, "response", "send", "07", "200, predictedCategory", "always HTTP 200",
           "Even a caught internal error returns 200 with an error field."),
]
o.chain(t, o.R1_CY)
tail_error(o, t, 6, "Never returns an unknown label",
           ["labelEncoder.inverse_transform", "can only emit a category the", "model was actually trained on."])
save(o, o.render(["Frontend AddExpense.js debounces this call 500ms per keystroke through the "
                  "backend proxy — not a raw fetch straight to the ML service."],
                 "ML-API-08"),
     "ml-api-08-predict-category-overview.svg")


# ===========================================================================
# ML-API-09 — POST /generate-description
# ===========================================================================
o = new("POST /generate-description — templated description text",
        "Quick overview · follow 01 → 06 · full detail in ml-api-09-generate-description-detailed.svg")
d, R1 = o.d, o.ROW1
d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "POST /generate-description",                          "auth"),
    ("Confirmed caller", "backend addexpense.js, only when description is blank", "insights"),
    ("No ML model involved", "Keyword rules + random.choice over static templates", "error"),
    ("Failure fallback", "Backend writes \"\" and proceeds — never blocks the save", "insights"),
])
d.note_box(882, 276, 516, 168, "Not a trained model at all", [
    "Despite living in inference/, descriptionGenerator.py is pure rule-based "
    "text: a keyword dictionary, then a random template pick, then an "
    "amount-based \"High-value\" prefix above 5000.",
], "insights")
t = [
    o.card(0, R1, "backend", "send", "01", "Backend Call", "addexpense.js",
           "Only when expenseDescription is blank on the request."),
    o.card(1, R1, "backend", "gears", "02", "Pydantic Validation", "DescriptionRequest",
           "expenseName, expenseCategory, expenseAmount."),
    o.card(2, R1, "backend", "gears", "03", "Keyword Match", "generate_keyword_description",
           "First substring match wins, e.g. \"uber\" -> Cab ride."),
    o.card(3, R1, "backend", "gears", "04", "Template Fallback", "random.choice(CATEGORY_TEMPLATES)",
           "Only if no keyword matched."),
    o.card(4, R1, "backend", "sigma", "05", "Amount Enrichment", "amount > 5000",
           "Prepends \"High-value \" to the chosen text."),
    o.card(5, R1, "response", "send", "06", "200, {description}", "single string",
           "Backend writes this into expenseDescription before saving."),
]
o.chain(t, o.R1_CY)
tail_error(o, t, 5, "Fallback discrepancy",
           ["addexpense.js's own log line", "says \"falling back to Others\"", "but writes \"\", not \"Others\"."])
save(o, o.render(["This endpoint never touches predictor_manager, MongoDB, or any joblib "
                  "artifact — the entire response is computed from the request body alone."],
                 "ML-API-09"),
     "ml-api-09-generate-description-overview.svg")


# ===========================================================================
# ML-API-10 — POST /retrain-model
# ===========================================================================
o = new("POST /retrain-model — accepting a retraining request",
        "Quick overview · follow 01 → 08 · full detail in ml-api-10-retrain-model-detailed.svg")
d, R1 = o.d, o.ROW1
d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "POST /retrain-model",                                 "auth"),
    ("Confirmed caller", "backend cron/feedbackCollector.js, daily 20:30", "insights"),
    ("Threshold",  "Only fires past 100 pending MlFeedback docs",         "backend"),
    ("202 means",  "Accepted + queued — never \"completed\", never \"promoted\"", "error"),
])
d.note_box(882, 276, 516, 168, "Idempotent under duplicate triggers", [
    "A second call while a run is active returns 200 with existingRun: true "
    "and creates no new record — the cron's own 503/retry handling treats "
    "that as normal, not an error.",
], "insights")
t = [
    o.card(0, R1, "backend", "gauge", "01", "Cron Threshold Met", "feedbackCollector.js",
           ">= 100 MlFeedback docs with status: pending."),
    o.card(1, R1, "backend", "gauge", "02", "Active-run Fast Path", "peek_active_run()",
           "Non-mutating read; short-circuits a duplicate trigger."),
    o.card(2, R1, "database", "save", "03", "Run Record Created", "create_run() -> queued",
           "Only if no live run was already found."),
    o.card(3, R1, "database", "key", "04", "Lock Claimed/Reclaimed", "claim_or_reclaim()",
           "Atomic MongoDB find_one_and_update."),
    o.card(4, R1, "backend", "gears", "05", "Background Thread Started", "background_retrain()",
           "Runs in-process, not a separate worker or queue."),
    o.card(5, R1, "response", "send", "06", "202, status: queued", "existingRun: false",
           "The full pipeline (ML-FLOW-07) has only just begun."),
    o.card(6, R1, "backend", "monitor", "07", "Or 200, existingRun", "when already active",
           "Same status code family either way — 2xx, never an error for this case."),
]
o.chain(t, o.R1_CY)
tail_error(o, t, 6, "Acceptance, not completion",
           ["This endpoint never waits for", "training — see ML-FLOW-07 for", "the actual multi-minute pipeline."])
save(o, o.render(["A MongoDB outage at any point before the lock is claimed returns 503 "
                  "before any run record is left dangling — see the run/lock cleanup helpers."],
                 "ML-API-10"),
     "ml-api-10-retrain-model-overview.svg")


# ===========================================================================
# ML-FLOW-01 — Prediction pipeline
# ===========================================================================
o = new("Prediction pipeline — from raw text to a category",
        "Quick overview · follow 01 → 07 · full detail in ml-flow-01-prediction-pipeline-detailed.svg")
d, R1 = o.d, o.ROW1
d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Feeds",      "ML-API-08 (POST /predict-category) exclusively",      "auth"),
    ("Model scope", "Global — one snapshot per process, shared by every user", "error"),
    ("Determinism", "RandomForest with a fixed random_state -> deterministic for a fixed model", "insights"),
    ("Category set", "Dynamic — whatever labelEncoder.classes_ currently holds", "backend"),
])
d.note_box(882, 276, 516, 168, "Conventional classification, not language understanding", [
    "TF-IDF + RandomForestClassifier over cleaned text — no embeddings, no "
    "LLM, no semantic similarity. Confidence is the model's own max class "
    "probability, not a calibrated certainty measure.",
], "insights")
t = [
    o.card(0, R1, "frontend", "cursor", "01", "Raw expenseName", "arbitrary string",
           "Empty, whitespace-only, unicode, or very long — all accepted."),
    o.card(1, R1, "backend", "database", "02", "Snapshot Acquired", "get_snapshot()",
           "Throttled manifest check; may trigger a lazy reload."),
    o.card(2, R1, "backend", "gears", "03", "Text Cleaned", "lower + strip non-alnum",
           "Whitespace-only input becomes an empty string, not rejected."),
    o.card(3, R1, "backend", "bolt", "04", "TF-IDF Transform", "vectorizer.transform([cleaned])",
           "Unseen tokens simply contribute nothing to the vector."),
    o.card(4, R1, "backend", "gears", "05", "Model Predicts", "model.predict(vector)",
           "One RandomForest, in-memory, shared across all requests."),
    o.card(5, R1, "backend", "sigma", "06", "Label Decoded", "labelEncoder.inverse_transform",
           "Can only emit a category the model actually learned."),
    o.card(6, R1, "response", "send", "07", "predictedCategory + confidence", "200 always",
           "Internal exceptions become {\"error\": ...}, not a 5xx."),
]
o.chain(t, o.R1_CY)
tail_error(o, t, 6, "Model can change mid-flight",
           ["get_snapshot()'s lazy reload", "means two concurrent requests", "can be served by different models."])
save(o, o.render(["A snapshot swap during an in-flight prediction cannot corrupt a single call — "
                  "current is read once into a local variable before use — but two overlapping "
                  "requests can legitimately be answered by two different model versions."],
                 "ML-FLOW-01"),
     "ml-flow-01-prediction-pipeline-overview.svg")


# ===========================================================================
# ML-FLOW-02 — Initial model loading & startup activation
# ===========================================================================
o = new("Startup model loading — what this process serves first",
        "Quick overview · follow 01 → 06 · full detail in ml-flow-02-startup-loading-detailed.svg")
d, R1 = o.d, o.ROW1
d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Entry point", "predictor_manager.initialize(), FastAPI startup handler", "backend"),
    ("Preferred source", "training/models/active.json, if valid and loadable", "database"),
    ("Fallback",   "training/model.pkl etc. — the pre-Phase-E fixed legacy files", "database"),
    ("Fails startup only if", "NEITHER the manifest candidate NOR the legacy files load", "error"),
])
d.note_box(882, 276, 516, 168, "Manifest is never auto-repaired", [
    "A corrupt or unreadable active.json is logged and bypassed in favor of "
    "the legacy fallback — it is never rewritten or deleted by this path.",
], "error")
t = [
    o.card(0, R1, "backend", "gears", "01", "Config Validated", "run_and_log_startup_validation",
           "Registered first; fatal errors abort startup here."),
    o.card(1, R1, "database", "file-text", "02", "Manifest Read", "model_bundle.read_manifest()",
           "None (normal, pre-first-activation) or a dict."),
    o.card(2, R1, "database", "database", "03", "Candidate Load Attempted", "_load_candidate()",
           "Bundle completeness, runId match, 3 runtime gates."),
    o.card(3, R1, "backend", "gears", "04", "Legacy Fallback", "_load_legacy()",
           "Used when no manifest exists or the candidate fails to activate."),
    o.card(4, R1, "backend", "save", "05", "Snapshot Assigned", "self._snapshot = snapshot",
           "The one RuntimeSnapshot this process now serves from."),
    o.card(5, R1, "response", "alert", "06", "Startup Continues or Fails", "ActivationError",
           "Fails ONLY if neither source could load."),
]
o.chain(t, o.R1_CY)
tail_error(o, t, 5, "Per-process, not per-deployment",
           ["Every worker/replica runs this", "independently — see ML-FLOW-01", "for how they later converge."])
save(o, o.render(["'Activated' at startup means only this process; other workers/replicas each "
                  "run this same sequence independently against the same shared manifest file."],
                 "ML-FLOW-02"),
     "ml-flow-02-startup-loading-overview.svg")


# ===========================================================================
# ML-FLOW-03 — Training-data construction
# ===========================================================================
o = new("Training-data construction — from feedback to a dataset snapshot",
        "Quick overview · follow 01 → 07 · full detail in ml-flow-03-dataset-construction-detailed.svg")
d, R1 = o.d, o.ROW1
d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Triggered by", "background_retrain(), the first pipeline stage",     "backend"),
    ("Sources",    "Static base CSV + trained feedback + this run's reservation", "database"),
    ("Duplicate cap", "3 identical (name, category) feedback pairs, env-configurable", "backend"),
    ("Cross-user data", "All users' expenses/corrections are pooled into one shared dataset", "error"),
])
d.note_box(882, 276, 516, 168, "Conflicts are kept, never auto-resolved", [
    "The same normalized expense name mapped to two different valid "
    "categories by different corrections is recorded in conflictCount but "
    "both rows are written — no automatic winner is chosen.",
], "insights")
t = [
    o.card(0, R1, "database", "refresh", "01", "Reservation Reconciled", "reconcile_reserved_feedback",
           "Recovers feedback orphaned by a dead prior run first."),
    o.card(1, R1, "database", "key", "02", "Pending Feedback Reserved", "reserve_pending_feedback()",
           "One atomic find_one_and_update per document."),
    o.card(2, R1, "database", "database", "03", "Trained Feedback Read", "get_trained_feedback()",
           "Cumulative — read-only, never mutated here."),
    o.card(3, R1, "backend", "gears", "04", "Rows Validated", "_validate_feedback_doc",
           "Unrecognized category -> needs_review, not silently dropped."),
    o.card(4, R1, "backend", "gears", "05", "Duplicates Capped", "DUPLICATE_CAP = 3",
           "Deterministic sort by (name, category, createdAt, _id)."),
    o.card(5, R1, "database", "save", "06", "Snapshot Written", "temp file + os.replace",
           "training/dataset/runs/<runId>/training_dataset.csv, immutable."),
    o.card(6, R1, "response", "sigma", "07", "SHA-256 + rowCounts", "metadata dict",
           "Attached to the run document by app.py, not this module."),
]
o.chain(t, o.R1_CY)
tail_error(o, t, 6, "One user can influence others",
           ["Because all users' feedback", "trains one shared global model", "— confirmed, not hypothetical."])
save(o, o.render(["A malformed feedback document never crashes the run — it is reported invalid "
                  "and, for this run's own reservations, moved to needs_review."],
                 "ML-FLOW-03"),
     "ml-flow-03-dataset-construction-overview.svg")


# ===========================================================================
# ML-FLOW-04 — Model training & evaluation
# ===========================================================================
o = new("Model training & evaluation — producing a candidate bundle",
        "Quick overview · follow 01 → 07 · full detail in ml-flow-04-training-evaluation-detailed.svg")
d, R1 = o.d, o.ROW1
d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Runs as",    "A separate trainer.py subprocess, not in-process",     "backend"),
    ("Estimator",  "RandomForestClassifier, 30 trees, random_state=42",    "backend"),
    ("Vectorizer", "TfidfVectorizer, max_features=1000",                  "backend"),
    ("Split",      "80/20, stratified; falls back to non-stratified on ValueError", "insights"),
])
d.note_box(882, 276, 516, 168, "A failed split can leak near-duplicates", [
    "The non-stratified fallback (triggered by a class with < 2 members) has "
    "no de-duplication step of its own — a near-identical row can still land "
    "in both train and test.",
], "error")
t = [
    o.card(0, R1, "backend", "database", "01", "Dataset Loaded", "pd.read_csv(snapshot)",
           "Required columns checked; missing ones fail the run."),
    o.card(1, R1, "backend", "gears", "02", "Text + Category Cleaned", "shared category_config",
           "Same alias mapping used by dataset_builder's own validation."),
    o.card(2, R1, "backend", "bolt", "03", "TF-IDF Fit", "vectorizer.fit_transform",
           "Fit fresh every run — never reused across runs."),
    o.card(3, R1, "backend", "sigma", "04", "Labels Encoded", "LabelEncoder.fit_transform",
           "classes_ becomes the new model's category set."),
    o.card(4, R1, "backend", "gears", "05", "Train/Test Split", "stratify=y, seed 42",
           "ValueError (rare class) falls back to a plain split."),
    o.card(5, R1, "backend", "gears", "06", "Fit + Evaluate", "accuracy_score",
           "A failed evaluation still lets the bundle save proceed."),
    o.card(6, R1, "database", "save", "07", "Bundle Written", "model_bundle.write_bundle()",
           "Temp-dir-then-rename; never overwrites an existing version."),
]
o.chain(t, o.R1_CY)
tail_error(o, t, 6, "Evaluation failure ≠ training failure",
           ["A candidate with metrics=None", "still gets a bundle on disk —", "gate 6 (ML-FLOW-05) rejects it."])
save(o, o.render(["A subprocess exit code != 0, or a missing result file, is what "
                  "retrain_pipeline.py treats as an unrecoverable training-stage failure."],
                 "ML-FLOW-04"),
     "ml-flow-04-training-evaluation-overview.svg")


# ===========================================================================
# ML-FLOW-05 — Validation & promotion decision
# ===========================================================================
o = new("Validation gates — deciding if a candidate is publishable",
        "Quick overview · follow 01 → 07 · full detail in ml-flow-05-validation-promotion-detailed.svg")
d, R1 = o.d, o.ROW1
d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Runs as",    "A separate validate_model.py subprocess",              "backend"),
    ("Gate count", "9, strictly ordered, stop-at-first-hard-failure",      "backend"),
    ("Regression threshold", "ML_MAX_ACCURACY_REGRESSION — repo .env unset -> 0.05 fallback, not the 0.02 documented in .env.example", "error"),
    ("First run",  "Gates 7 (regression) and 9 (category set) are SKIPPED, not passed/failed", "insights"),
])
d.note_box(882, 276, 516, 168, "\"Publishable\" is not \"live\"", [
    "Passing all 9 gates only means the candidate MAY be activated — "
    "activation itself (ML-FLOW-06) is a separate, later decision that can "
    "still fail independently.",
], "error")
t = [
    o.card(0, R1, "backend", "gears", "01", "Completeness + Loadability", "gates 1-2",
           "Every artifact file present, non-empty, and deserializable."),
    o.card(1, R1, "backend", "gears", "02", "Compatibility Gates", "gates 3-4",
           "Vectorizer/model feature count; encoder/model class count."),
    o.card(2, R1, "backend", "sigma", "03", "Dataset + Metrics Gates", "gates 5-6",
           "metadata.json must match the exact hash/row counts used."),
    o.card(3, R1, "backend", "gauge", "04", "Regression Gate", "gate 7, skippable",
           "Compares against the CURRENTLY ACTIVE run's own accuracy."),
    o.card(4, R1, "backend", "bolt", "05", "Smoke Predictions", "gate 8",
           "4 fixed inputs must produce non-empty labels end-to-end."),
    o.card(5, R1, "backend", "gears", "06", "Category-set Gate", "gate 9, skippable",
           "Hard failure only if a previously-supported category vanished."),
    o.card(6, R1, "response", "send", "07", "success + 9 gate results", "always all 9 named",
           "Skipped gates after a failure are recorded, never omitted."),
]
o.chain(t, o.R1_CY)
tail_error(o, t, 6, "Never claims real-world correctness",
           ["These gates check structural", "and statistical soundness —", "not financial correctness."])
save(o, o.render(["The regression baseline (gate 7) is the ACTIVE run's own accuracy, sourced "
                  "from active.json's runId — never merely 'the latest experiment'."],
                 "ML-FLOW-05"),
     "ml-flow-05-validation-promotion-overview.svg")


# ===========================================================================
# ML-FLOW-06 — Artifact persistence & atomic activation
# ===========================================================================
o = new("Artifact persistence & activation — going live safely",
        "Quick overview · follow 01 → 07 · full detail in ml-flow-06-persistence-activation-detailed.svg")
d, R1 = o.d, o.ROW1
d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Ordering",   "preload+validate BEFORE publishing the manifest, always",  "backend"),
    ("Atomicity",  "temp-dir rename (bundle); temp-file os.replace (manifest)", "database"),
    ("Rollback",   "Restores the exact previous snapshot + manifest on failure", "insights"),
    ("Multi-worker", "Only THIS process is activated immediately; others lazily catch up", "error"),
])
d.note_box(882, 276, 516, 168, "The manifest can never point at the unloadable", [
    "Because preload_candidate() always runs before write_manifest(), the "
    "one invariant this whole workflow protects is that active.json never "
    "references a bundle this process itself could not load.",
], "insights")
t = [
    o.card(0, R1, "backend", "database", "01", "Preload Candidate", "preload_candidate()",
           "Loads + 3 runtime gates; manifest untouched if this fails."),
    o.card(1, R1, "database", "save", "02", "Manifest Published", "write_manifest()",
           "Atomic os.replace; generation incremented by 1."),
    o.card(2, R1, "backend", "refresh", "03", "Local Snapshot Swapped", "swap_in()",
           "Single attribute assignment, GIL-atomic."),
    o.card(3, R1, "backend", "bolt", "04", "Post-swap Smoke Test", "smoke_test()",
           "Final end-to-end confirmation on the now-live snapshot."),
    o.card(4, R1, "response", "alert", "05", "Rollback on Failure", "_rollback_manifest",
           "Restores the previous manifest or removes a first-ever one."),
    o.card(5, R1, "database", "save", "06", "Run Marked Activated", "mark_activated()",
           "Only after every prior step has actually succeeded."),
    o.card(6, R1, "database", "gauge", "07", "Feedback Finalized", "finalize_trained_for_run",
           "A failure here is bookkeeping-only — the model stays live."),
]
o.chain(t, o.R1_CY)
tail_error(o, t, 6, "Database can outlive the artifact",
           ["Nothing prevents an operator", "from manually deleting a bundle", "directory active.json still cites."])
save(o, o.render(["A swap/smoke failure restores the PREVIOUS in-memory snapshot before the "
                  "manifest rollback runs, so this process is never left serving a mismatch."],
                 "ML-FLOW-06"),
     "ml-flow-06-persistence-activation-overview.svg")


# ===========================================================================
# ML-FLOW-07 — Background retraining lifecycle (umbrella)
# ===========================================================================
o = new("Background retraining lifecycle — the full run, end to end",
        "Quick overview · follow 01 → 08 · full detail in ml-flow-07-retraining-lifecycle-detailed.svg")
d, R1 = o.d, o.ROW1
d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Spans",      "ML-API-10's response through ML-FLOW-03 → 06 and cleanup", "backend"),
    ("Concurrency", "One MongoDB-backed lock; one in-process Thread per run", "backend"),
    ("Lock release", "Only in the outer finally, after activation-or-rollback is terminal", "insights"),
    ("Process restart", "Kills the Thread silently — see ML-FLOW-08 for recovery", "error"),
])
d.note_box(882, 276, 516, 168, "Still one process's background thread", [
    "The MongoDB lock makes this safe ACROSS processes/workers, but within "
    "one process it is an ordinary daemon Thread — a hard kill of that "
    "process loses the thread with no in-process trace.",
], "error")
t = [
    o.card(0, R1, "backend", "gears", "01", "Run Marked Running", "mark_running()",
           "First status write inside the background thread."),
    o.card(1, R1, "database", "database", "02", "Baseline Fetched", "_fetch_baseline()",
           "The ACTIVE run's own accuracy/categories, or None on a first run."),
    o.card(2, R1, "backend", "gears", "03", "Pipeline Runs", "run_retraining()",
           "ML-FLOW-03 -> 04 -> 05 in sequence, heartbeats between stages."),
    o.card(3, R1, "database", "save", "04", "Candidate Persisted", "persist_model_candidate",
           "Recorded whenever a bundle exists, pass or fail."),
    o.card(4, R1, "backend", "bolt", "05", "Activation Attempted", "_attempt_activation()",
           "ML-FLOW-06, only if validation succeeded."),
    o.card(5, R1, "database", "gauge", "06", "Terminal Status Set", "activated | failed_*",
           "Six possible terminal outcomes total, see the state table."),
    o.card(6, R1, "backend", "refresh", "07", "Cleanup Runs", "model_cleanup.run_cleanup",
           "Best-effort, only after activation/feedback are already terminal."),
    o.card(7, R1, "database", "key", "08", "Lock Released", "release_lock()",
           "Outer finally — always, owner-checked, regardless of outcome."),
]
o.chain(t, o.R1_CY)
tail_error(o, t, 7, "Six distinct terminal states",
           ["activated / failed / failed_", "validation / failed_activation —", "never collapsed into one \"done\"."])
save(o, o.render(["This is the umbrella lifecycle the rules explicitly permit alongside "
                  "endpoint-level documentation — it does not replace ML-FLOW-03 through 06, "
                  "which remain independently documented for their own internal detail."],
                 "ML-FLOW-07"),
     "ml-flow-07-retraining-lifecycle-overview.svg")


# ===========================================================================
# ML-FLOW-08 — Startup reconciliation
# ===========================================================================
o = new("Startup reconciliation — recovering from a crash mid-pipeline",
        "Quick overview · follow 01 → 07 · full detail in ml-flow-08-startup-reconciliation-detailed.svg")
d, R1 = o.d, o.ROW1
d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Runs",       "Once, at FastAPI startup, after the predictor is initialized", "backend"),
    ("Three independent sweeps", "orphaned runs, feedback reservations, activation state", "backend"),
    ("Never blocks startup", "Every sweep is wrapped in its own try/except",     "insights"),
    ("Trusts",     "The manifest + bundle files as ground truth, never a bare status field alone", "backend"),
])
d.note_box(882, 276, 516, 168, "\"Running\"/\"evaluating\" recovered the same way", [
    "reconcile_orphaned_runs treats both statuses identically for orphan "
    "detection — a run stuck in either one, whose runId no longer matches "
    "the current lock, is resolved as failed.",
], "insights")
t = [
    o.card(0, R1, "database", "gauge", "01", "Orphaned-run Sweep", "reconcile_orphaned_runs",
           "Stale-queued (age-based) + lock-mismatched running/evaluating."),
    o.card(1, R1, "database", "refresh", "02", "Feedback Reservation Sweep", "reconcile_reserved_feedback",
           "Releases \"reserved\" docs whose owning run is gone/terminal."),
    o.card(2, R1, "database", "file-text", "03", "Manifest Re-read", "read_manifest()",
           "Ground truth for the activation-state sweep below."),
    o.card(3, R1, "backend", "gauge", "04", "Activating Runs Recovered", "_reconcile_activating_run",
           "Manifest match + valid bundle -> activated; else failed_activation."),
    o.card(4, R1, "database", "gauge", "05", "Leftover Reserved Feedback Finalized", "case 2",
           "An already-activated run whose feedback never finalized."),
    o.card(5, R1, "backend", "gauge", "06", "Pre-activation Manifest Match", "case 3",
           "evaluating/completed run the manifest already claims is live."),
    o.card(6, R1, "response", "monitor", "07", "Structured Summary Logged", "run_reconciliation event",
           "Counts per sweep, never a silent no-op."),
]
o.chain(t, o.R1_CY)
tail_error(o, t, 6, "Startup-only, not periodic",
           ["Nothing re-runs this sweep", "later — a crash after startup", "waits for the NEXT restart."])
save(o, o.render(["Every decision here is re-derived from the manifest and bundle files, never "
                  "from trusting a MongoDB status field in isolation."],
                 "ML-FLOW-08"),
     "ml-flow-08-startup-reconciliation-overview.svg")


# ===========================================================================
# ML-FLOW-09 — Backend-to-ML categorization integration
# ===========================================================================
o = new("Backend <-> ML categorization integration — the full user round trip",
        "Quick overview · follow 01 → 08 · full detail in ml-flow-09-backend-integration-detailed.svg")
d, R1 = o.d, o.ROW1
d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Spans",      "Node/Express backend + Python/FastAPI ML service, no new endpoint", "backend"),
    ("Auth between services", "Operations token on ML calls; /ping remains an unauthenticated probe", "auth"),
    ("ML unavailable", "predict-category: 503 to the frontend; description: silent \"\" fallback", "insights"),
    ("Correction loop", "A user's edit becomes an mlfeedbacks doc, feeding ML-FLOW-03 later", "insights"),
])
d.note_box(882, 276, 516, 168, "Prediction is a UI convenience, not a gate", [
    "The backend's own addExpense controller never calls /predict-category — "
    "only the frontend does, pre-submission. Expense creation is never "
    "blocked on a prediction succeeding or failing.",
], "insights")
t = [
    o.card(0, R1, "frontend", "cursor", "01", "User Types a Name", "AddExpense.js",
           "Debounced 500ms, skips inputs under 3 characters."),
    o.card(1, R1, "backend", "send", "02", "Backend Proxy", "POST /ml/predict-category",
           "verifyToken-gated on the backend; 5 s timeout to the ML service."),
    o.card(2, R1, "backend", "gears", "03", "Category Pre-filled", "setCategory()",
           "User can accept or override before submitting."),
    o.card(3, R1, "backend", "gears", "04", "Description Generated", "addexpense.js",
           "Only when the client submitted no description."),
    o.card(4, R1, "database", "save", "05", "Feedback Written", "MlFeedbackModel",
           "Only if hasPrediction && confidence !== undefined."),
    o.card(5, R1, "database", "save", "06", "Expense Persisted", "newExpense.save()",
           "Always proceeds, even if every ML call above failed."),
    o.card(6, R1, "backend", "gauge", "07", "Cron Threshold Check", "feedbackCollector.js",
           "Daily 20:30, counts status: pending, needs >= 100."),
    o.card(7, R1, "backend", "send", "08", "Retrain Triggered", "POST /retrain-model",
           "Feeds directly into ML-FLOW-07."),
]
o.chain(t, o.R1_CY)
tail_error(o, t, 7, "ML token configuration is required",
           ["ML calls carry X-ML-Operations-Token.", "If either side lacks the configured", "shared token, protected endpoints fail closed."])
save(o, o.render(["This is the flow the rules call out explicitly as combined/internal because "
                  "it spans two runtimes and introduces no new HTTP endpoint of its own."],
                 "ML-FLOW-09"),
     "ml-flow-09-backend-integration-overview.svg")
