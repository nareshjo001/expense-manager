"""
ML-API-11 Level 1 — POST /ml/predict-category (backend proxy)

Created during the repository-wide API coverage gate. This is the Express endpoint
itself, distinct from ML-API-08's FastAPI POST /predict-category. A separate script,
not appended to build_ml_overviews.py, so the existing 19-workflow ML Service set is
untouched by this addition.

Run:  python3 build_ml_api11_overview.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))   # shared engine lives one level up

from workflow_diagram import Overview, load_tokens   # noqa: E402

o = Overview(load_tokens(),
             title="POST /ml/predict-category — backend proxy to the ML service",
             subtitle="Quick overview · follow 01 -> 08 · full detail in "
                      "ml-api-11-backend-predict-proxy-detailed.svg")
d = o.d
C, R1, R2 = o.COL, o.ROW1, o.ROW2

d.group_box(1116, o.BAND_Y, 470, o.BAND_H, "FastAPI (ML-API-08)", "insights",
            note="cross-referenced, not re-documented")

d.facts_panel(34, o.BAND_Y, 1060, o.BAND_H, "At a glance", [
    ("Endpoint",   "POST /ml/predict-category",                 "response"),
    ("Auth",       "Required - verifyToken (the real auth boundary)", "auth"),
    ("Downstream", "axios.post, 5000ms timeout to ML-API-08",   "insights"),
    ("Blind spot", "Forwards ML-API-08's body without inspecting it for an error key", "error"),
    ("Caller",     "AddExpense.js, 500ms-debounced useEffect",  "ui"),
])

s1 = o.card(0, R1, "ui", "cursor", "01", "Name Typed", "AddExpense.js",
            "Debounced 500ms, min 3 characters.")
s2 = o.card(1, R1, "frontend", "send", "02", "Authorized Request", "Axios Client",
            "Attaches the JWT.")
s3 = o.card(2, R1, "auth", "shield", "03", "API Security", "Limiter + JWT",
            "apiLimiter, then verifyToken.")
s4 = o.card(3, R1, "auth", "gauge", "04", "Field Check", "expenseName truthy",
            "Single truthiness check, no schema.")
s5 = o.card(4, R1, "insights", "send", "05", "Proxy Call", "axios.post, 5s timeout",
            "Attaches X-ML-Operations-Token.")
s8 = o.card(7, R1, "response", "send", "08", "Respond", "200 / 400 / 503 / 4xx / 500",
            "Body forwarded verbatim on 2xx.")

s6 = o.card(6, R2, "insights", "chart", "06", "ML Prediction", "ML-API-08 target",
            "POST /predict-category on the FastAPI service.")
s7 = o.card(7, R2, "error", "alert", "07", "Three-Way Branch", "catch (error)",
            "No response / 4xx / other -> 503 / forwarded / 500.")

o.chain([s1, s2, s3, s4, s5], o.R1_CY)
d.path([(s5.cx, s5.bottom), (s5.cx, s6.y)], "insights", width=2.8,
       label="PROXIED CALL", label_at=(s5.cx, o.LABEL_Y))
d.path([(s6.right, o.R2_CY), (s7.x, o.R2_CY)], "insights", width=2.4)
d.path([(s7.cx, s7.y), (s7.cx, s8.bottom)], "response", width=3.0,
       label="TRANSLATED", label_at=(s7.cx, o.LABEL_Y))

ep = d.pal("error")
d.path([(s8.cx, s8.bottom), (s8.cx, 458)], "error", dashed=True)
d.mid.append('<g><rect x="%d" y="458" width="%d" height="98" rx="10" fill="%s" '
             'stroke="%s" stroke-width="1" stroke-dasharray="4 3"/>%s%s%s%s%s</g>'
             % (C[8], o.CW, ep["fill"], ep["border"],
                d._icon("alert", C[8] + 13, 470, ep["line"], 0.78),
                d._text(C[8] + 34, 483, "Masked internal failure", 10.8, ep["ink"], 700),
                d._text(C[8] + 13, 506, "A 200 with {\"error\":...}", 9.8, d.n["inkMuted"], 400),
                d._text(C[8] + 13, 519, "from ML-API-08 is forwarded", 9.8, d.n["inkMuted"], 400),
                d._text(C[8] + 13, 532, "as a success, unchecked.", 9.8, d.n["inkMuted"], 400)))

svg = o.render(["This is the real auth boundary for the whole prediction round trip -- ML-API-08 "
                "itself also requires the operations token."], "ML-API-11")
open(os.path.join(HERE, "backend-predict-proxy", "ml-api-11-backend-predict-proxy-overview.svg"), "w",
     encoding="utf-8").write(svg)
print("wrote ml-api-11-backend-predict-proxy-overview.svg", len(svg), "bytes")
