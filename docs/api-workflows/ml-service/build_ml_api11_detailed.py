"""
ML-API-11 Level 2 — detailed implementation workflow for
POST /ml/predict-category (backend proxy)

Created during the repository-wide API coverage gate. A separate script, not appended
to build_ml_detailed.py, so the existing 19-workflow ML Service set is untouched by
this addition.

Run:  python3 build_ml_api11_detailed.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))   # shared engine lives one level up

from workflow_diagram import Diagram, load_tokens   # noqa: E402

T = load_tokens()
L, C = T["layout"], T["canvas"]
Y0, PITCH, CW = L["firstCardY"], L["cardPitch"], L["cardWidth"]

d = Diagram(T,
            title="POST /ml/predict-category (backend proxy) — detailed implementation workflow",
            subtitle="Level 2 · real functions and middleware · badges map to the 8 "
                     "stages in ml-api-11-backend-predict-proxy-overview.svg")

r1 = d.region(20,   272, "Frontend Trigger", "Debounced name input", accent="ui", step=1)
r2 = d.region(306,  272, "API Security", "Middleware chain, in order", accent="auth", step=2)
r3 = d.region(592,  272, "Proxy Handler", "ml.router.js", accent="backend", step=3)
r4 = d.region(878,  272, "ML Service (cross-referenced)", "ML-API-08 · not re-documented here",
              accent="insights", step=4)
r5 = d.region(1164, 496, "Response Translation", "Three-way branch on failure",
              accent="response", step=5)


def col(region, i):
    return region.card_x, Y0 + i * PITCH


a1 = d.card(*col(r1, 0), "ui", "cursor", "TRIGGER", "Name Typed", "expenseName state",
            "Debounced 500ms, min 3 characters, skips programmatic changes.", step="01")
a2 = d.card(*col(r1, 1), "frontend", "send", "API CLIENT", "Authorized Request",
            "api.interceptors.request",
            "Adds Authorization: Bearer <token> from localStorage.", step="02")
d.flow_down(a1, a2)

b1 = d.card(*col(r2, 0), "auth", "gauge", "MIDDLEWARE", "Rate Limiter", "apiLimiter",
            "Shared with /expense, /bills, /report, /chart, /income.", step="03", tag="E1")
b2 = d.card(*col(r2, 1), "auth", "shield", "MIDDLEWARE", "Token Validation", "verifyToken()",
            "User JWT validation; ML-API-08 also validates the operations token.",
            step="03", tag="E2")
d.flow_down(b1, b2)
d.handoff(a2, b1, 299)

c1 = d.card(*col(r3, 0), "backend", "gauge", "VALIDATION", "Field Check",
            "if (!expenseName)",
            "Single truthiness check -- no schema, no type guard.", step="04", tag="E3")
c2 = d.card(*col(r3, 1), "backend", "send", "OUTBOUND", "Proxy Call",
            "axios.post(...), 5s timeout",
            "Attaches X-ML-Operations-Token via mlOperationsHeaders().", step="05")
d.flow_down(c1, c2)
d.handoff(b2, c1, 585)

e1 = d.card(r4.card_x, Y0, "insights", "chart", "CROSS-REF", "ML-API-08 Handler",
            "POST /predict-category (FastAPI)",
            "Full pipeline documented separately -- not repeated here.", step="06")
d.handoff(c2, e1, 871)

f0 = d.card(1180, Y0, "response", "send", "BRANCH", "catch (error)",
            "three-way classification",
            "error.response absent / 4xx / anything else.",
            w=464, step="07", tag="E4")
d.handoff(e1, f0, 1157, kind="response", width=T["stroke"]["responsePath"],
          label="RESOLVED OR REJECTED")

d.sub_region(1172, 232, 236, 342, "Response shapes", "response")
LY = 264
g1 = d.card(1420, LY, "response", "send", "SUCCESS", "200 Forwarded",
            "res.status(200).json(response.data)",
            "ML-API-08's body forwarded verbatim, unchecked for an error key.",
            step="08", tag="E5")
g2 = d.card(1420, LY + PITCH, "error", "alert", "UNREACHABLE", "503",
            "error.response absent",
            "Timeout, DNS failure, or connection refused.", step="08")
g3 = d.card(1420, LY + 2 * PITCH, "error", "alert", "4XX / 500", "Forwarded or generic",
            "status + body / 500",
            "ML 4xx forwarded as-is; anything else becomes a generic 500.", step="08")
d.flow_down(g1, g2); d.flow_down(g2, g3)
d.path([(g1.x - 30, f0.bottom), (g1.x - 30, g1.y)], "response",
       width=T["stroke"]["primaryPath"])

d.exception_band(20, C["bandTop"], 1640, C["bandBottom"] - C["bandTop"],
                 "Exceptions and Current Limitations")
BW, BH, BY = L["bandCardWidth"], L["bandCardHeight"], 982
BX = [40, 309, 578, 847, 1116, 1385]

x1 = d.exception_card(BX[0], BY, BW, BH, "E1", "429 Too Many Requests", "apiLimiter",
                      "More than 150 requests in 15 minutes from the same IP address.")
x2 = d.exception_card(BX[1], BY, BW, BH, "E2", "ML token is required downstream",
                      "X-ML-Operations-Token",
                      "The proxy attaches the shared token; a missing or invalid token "
                      "is rejected before the ML service performs inference.")
x3 = d.exception_card(BX[2], BY, BW, BH, "E3", "400 expenseName is required",
                      "if (!expenseName)",
                      "A falsy value (0, false, \"\") is rejected; any other truthy "
                      "value is forwarded unvalidated as to type.")
x4 = d.exception_card(BX[3], BY, BW, BH, "E4", "503 and 500 share one message",
                      "\"Prediction service unavailable\"",
                      "Only the status code distinguishes ML-service-unreachable from "
                      "ML-service-5xx-or-unexpected-error.")
x5 = d.exception_card(BX[4], BY, BW, BH, "E5", "Masked internal failure",
                      "no inspection of response.data",
                      "A 200 containing {\"error\": ...} from ML-API-08 is forwarded as "
                      "a success -- this proxy never checks for that key.")

d.path([(b1.right, b1.cy), (852, b1.cy), (852, 894), (28, 894), (28, x1.cy),
        (x1.x, x1.cy)], "error", dashed=True)
d.path([(b2.right, b2.cy), (852, b2.cy), (852, 902), (400, 902), (400, x2.y)],
       "error", dashed=True)
d.path([(c1.cx, c1.bottom), (c1.cx, 910), (x3.cx, 910), (x3.cx, x3.y)],
       "error", dashed=True)
d.path([(f0.x, f0.bottom), (f0.x, 918), (x4.cx, 918), (x4.cx, x4.y)],
       "error", dashed=True)
d.path([(g1.right, LY + 6), (1584, LY + 6), (1584, 926), (x5.cx, 926), (x5.cx, x5.y)],
       "error", dashed=True)

svg = d.render(
    meta_right="BALENISA · Personal Finance Platform",
    meta_left="docs/api-workflows · ML-API-11 · Level 2 detailed",
    footer_notes=[
        "Heavy arrows are region hand-offs; the cyan one is the HTTP response. Light arrows are steps inside a region.",
        "The FastAPI side (ML-API-08) is cross-referenced, not re-documented -- see that endpoint's own Level 2 diagram.",
    ])
open(os.path.join(HERE, "backend-predict-proxy", "ml-api-11-backend-predict-proxy-detailed.svg"), "w",
     encoding="utf-8").write(svg)
print("wrote ml-api-11-backend-predict-proxy-detailed.svg", len(svg), "bytes")
