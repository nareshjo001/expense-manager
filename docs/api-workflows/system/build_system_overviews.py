"""
Level 1 overviews for the System module (SYSTEM-01, SYSTEM-02, SYSTEM-03).

These three endpoints were found during the repository-wide API coverage gate, not
during a prior module audit. Two are near-trivial (GET / and GET /ping); the third
(POST /api/device-token) is a real feature with no existing module home. Reuses the
approved BALENISA design system unchanged.

Run:  python3 build_system_overviews.py
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
    open(os.path.join(HERE, name), "w", encoding="utf-8").write(svg)
    print("wrote", name, len(svg))


# ===========================================================================
# SYSTEM-01 — GET /
# ===========================================================================
o = new("GET / — backend root liveness string",
        "Quick overview · follow 01 -> 04 · full detail in system-api-01-root-detailed.svg")
d, R1, R2 = o.d, o.ROW1, o.ROW2

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "GET /",                                   "response"),
    ("Auth",       "None",                                    "auth"),
    ("Mount",      "Declared directly on app, above every router", "backend"),
    ("DB check",   "None - the text is a static literal",     "error"),
    ("Caller",     "No frontend caller - external checks only", "ui"),
])

s1 = o.card(0, R1, "ui", "cursor", "01", "External Caller", "curl / monitor",
            "Not called by this app's own frontend.")
s2 = o.card(1, R1, "backend", "gauge", "02", "Express App", "server.js",
            "cors + express.json only - no limiter, no auth.")
s3 = o.card(2, R1, "backend", "layers", "03", "Inline Handler", "app.get(\"/\", ...)",
            "One synchronous res.send call.")
s4 = o.card(3, R1, "response", "send", "04", "Static Response", "200 text",
            "“Welcome! Connected to DB...” - unconditional.")

o.chain([s1, s2, s3, s4], o.R1_CY)

error_card(o, o.COL[8], 460, o.CW, "Text asserts what it never checks",
           ["The DB-connected message is a", "literal string - no mongoose", "connection state is read."])
d.path([(s4.right, o.R1_CY), (1584, o.R1_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)

save(o, o.render(["No middleware beyond cors/json. No auth, no rate limit, no downstream call - "
                  "the entire handler is one line."], "SYSTEM-01"),
     "system-api-01-root-overview.svg")


# ===========================================================================
# SYSTEM-02 - GET /ping
# ===========================================================================
o = new("GET /ping - cross-service health aggregation",
        "Quick overview · follow 01 -> 06 · full detail in system-api-02-ping-detailed.svg")
d, R1, R2 = o.d, o.ROW1, o.ROW2

d.group_box(882, 276, 704, 180, "ML service (proxied)", "insights",
            note="ML-API-02 · GET / · no credential attached",
            label_x=996, note_x=1180)

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "GET /ping",                                "response"),
    ("Auth",       "None on either leg",                       "auth"),
    ("Downstream", "axios.get(ML_ROUTE + \"/\")",              "insights"),
    ("Timeout",    "None configured on this call",             "error"),
    ("Caller",     "No frontend caller - external checks only", "ui"),
])

s1 = o.card(0, R1, "ui", "cursor", "01", "External Caller", "curl / monitor",
            "Not called by this app's own frontend.")
s2 = o.card(1, R1, "backend", "gauge", "02", "Express App", "server.js",
            "No limiter, no auth ahead of the handler.")
s3 = o.card(2, R1, "auth", "key", "03", "Inline Handler", "app.get(\"/ping\", ...)",
            "One try/catch wraps the whole body.")
s5 = o.card(6, R1, "response", "send", "05", "Aggregated Response", "200 / 503",
            "{success, backend, ml} - collapsed error detail.")
s6 = o.card(7, R1, "ui", "layout", "06", "External Consumer", "Uptime tooling",
            "Reads the combined status.")

s4 = o.card(6, R2, "insights", "chart", "04", "ML Root Probe", "ML-API-02 target",
            "GET / on the ML service, unauthenticated.")

o.chain([s1, s2, s3], o.R1_CY)
d.path([(s3.cx, s3.bottom), (s3.cx, s4.y)], "backend", width=2.8,
       label="PROXIED CALL", label_at=(s3.cx, o.LABEL_Y))
d.path([(s4.cx, s4.y), (s4.cx, s5.bottom)], "insights", width=3.0,
       label="200 or ERROR", label_at=(s4.cx, o.LABEL_Y))
o.chain([s5, s6], o.R1_CY)

error_card(o, o.COL[8], 460, o.CW, "No timeout on the downstream call",
           ["Unlike predict-category's 5s", "timeout, this axios.get has", "none - it can hang."])
d.path([(s6.right, o.R1_CY), (1584, o.R1_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)

save(o, o.render(["Network error, DNS failure, and an ML-side 5xx are all reported identically as "
                  "“ml: down” - the catch block does not distinguish them."], "SYSTEM-02"),
     "system-api-02-ping-overview.svg")


# ===========================================================================
# SYSTEM-03 - POST /api/device-token
# ===========================================================================
o = new("POST /api/device-token - registering a push device",
        "Quick overview · follow 01 -> 09 · full detail in system-api-03-device-token-detailed.svg")
d, R1, R2 = o.d, o.ROW1, o.ROW2

d.group_box(882, 276, 704, 180, "Claim-or-create logic", "database",
            note="unique index on token -> 409 on cross-user collision",
            label_x=996, note_x=1180)

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "POST /api/device-token",                   "response"),
    ("Auth",       "Required - verifyToken",                   "auth"),
    ("Transport",  "Raw fetch - bypasses shared axios client", "error"),
    ("Uniqueness", "One token -> one user, enforced by index", "database"),
    ("Retention",  "No expiry - nothing ever deletes a row",  "error"),
])

s1 = o.card(0, R1, "ui", "cursor", "01", "Push Permission", "Web/Native prompt",
            "useWebPush / useMobilePush.")
s2 = o.card(1, R1, "frontend", "key", "02", "Token Obtained", "FCM / Capacitor",
            "Browser or native push token.")
s3 = o.card(2, R1, "frontend", "send", "03", "Raw fetch Call", "POST request",
            "Not the shared axios instance.")
s4 = o.card(3, R1, "auth", "shield", "04", "API Security", "Limiter + JWT",
            "apiLimiter, then verifyToken.")
s5 = o.card(4, R1, "auth", "gauge", "05", "Field Validation", "deviceRegistration",
            "token non-empty, platform enum.")
s6 = o.card(5, R1, "database", "save", "06", "Claim Existing", "findOneAndUpdate",
            "Same (token, userId) -> refresh.")
s9 = o.card(7, R1, "response", "send", "09", "Respond", "200 / 409 / 400",
            "No success flag on the 200 body.")

s7 = o.card(6, R2, "database", "layers", "07", "Create New", "DeviceToken.create",
            "Only if the claim found nothing.")
s8 = o.card(7, R2, "error", "alert", "08", "Collision Check", "code 11000",
            "Token owned by another user -> 409.")

o.chain([s1, s2, s3, s4, s5, s6], o.R1_CY)
d.path([(s6.cx, s6.bottom), (s6.cx, s7.y)], "database", width=2.8,
       label="NOT CLAIMED", label_at=(s6.cx, o.LABEL_Y))
d.path([(s7.right, o.R2_CY), (s8.x, o.R2_CY)], "database", width=2.4)
d.path([(s8.cx, s8.y), (s8.cx, s9.bottom)], "response", width=3.0,
       label="200 / 409", label_at=(s8.cx, o.LABEL_Y))

error_card(o, o.COL[8], 460, o.CW, "Silent non-409 failures",
           ["useWebPush only console.logs", "any status besides 409 - no", "retry, no user feedback."])
d.path([(s9.right, o.R1_CY), (1584, o.R1_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)

save(o, o.render(["No TTL or cleanup exists anywhere in the repository for a DeviceToken document - "
                  "registrations are permanent once written."], "SYSTEM-03"),
     "system-api-03-device-token-overview.svg")
