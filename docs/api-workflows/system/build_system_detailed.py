"""
Level 2 detailed diagrams for the System module (SYSTEM-01, SYSTEM-02, SYSTEM-03).

Three small, previously-undocumented endpoints found during the repository-wide API
coverage gate. Regions are kept few and simple, matching how little each handler
actually does — no invented middleware, no invented persistence layer.

Run:  python3 build_system_detailed.py
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


def stack(d, region, specs):
    made = []
    for i, sp in enumerate(specs):
        kind, icon, kicker, stage, impl, purpose = sp[:6]
        extra = sp[6] if len(sp) > 6 else {}
        made.append(d.card(region.card_x, Y0 + i * PITCH, kind, icon, kicker, stage,
                           impl, purpose, **extra))
    for a, b in zip(made, made[1:]):
        d.flow_down(a, b)
    return made


def band(d, cards):
    d.exception_band(20, C["bandTop"], 1640, C["bandBottom"] - C["bandTop"],
                     "Exceptions and Current Limitations")
    return [d.exception_card(BX[i], BY, BW, BH, *c) for i, c in enumerate(cards)]


def refs(d, pairs):
    for pt, rail, gi, tgt, enter in pairs:
        y = (894, 902, 910, 918, 926, 934)[gi]
        if enter == "left":
            d.path([pt, (rail, pt[1]), (rail, y), (28, y), (28, tgt.cy), (tgt.x, tgt.cy)],
                   "error", dashed=True)
        elif enter == "top-offset":
            d.path([pt, (rail, pt[1]), (rail, y), (400, y), (400, tgt.y)],
                   "error", dashed=True)
        else:
            d.path([pt, (rail, pt[1]), (rail, y), (tgt.cx, y), (tgt.cx, tgt.y)],
                   "error", dashed=True)


def finish(d, out, api_id, tail, foot):
    svg = d.render(meta_right="BALENISA · Personal Finance Platform",
                   meta_left="docs/api-workflows · %s · Level 2 detailed" % api_id,
                   footer_notes=[foot, tail])
    open(os.path.join(HERE, out), "w", encoding="utf-8").write(svg)
    print("wrote", out, len(svg))


FOOT = ("Heavy arrows are region hand-offs; the cyan one is the HTTP response. Light "
        "arrows are steps inside a region.")

# ===========================================================================
# SYSTEM-01 - GET /
# ===========================================================================
d = Diagram(T, title="GET / - detailed implementation workflow",
            subtitle="Level 2 · one inline handler, no middleware beyond cors/json · "
                     "badges map to the 4 stages in system-api-01-root-overview.svg")
r1 = d.region(20, 272, "Caller", "External only - no app frontend caller",
              accent="ui", step=1)
r2 = d.region(306, 272, "Express App", "Global middleware, in order", accent="backend",
              step=2)
r3 = d.region(592, 272, "Inline Handler", "app.js, above every router",
              accent="backend", step=3)
r4 = d.region(878, 272, "Response", "A static literal, always", accent="response",
              step=4)

a = stack(d, r1, [
    ("ui", "cursor", "EXTERNAL", "Uptime Monitor / curl", "GET /",
     "Not reachable from any code path in frontend/src.", {"step": "01", "tag": "E1"}),
])
b = stack(d, r2, [
    ("backend", "gauge", "MIDDLEWARE", "CORS", "cors()",
     "Applied globally, ahead of every route.", {"step": "02"}),
    ("backend", "layers", "MIDDLEWARE", "Body Parser", "express.json()",
     "Irrelevant here - GET / has no body.", {"step": "02"}),
])
c = stack(d, r3, [
    ("backend", "sigma", "HANDLER", "Inline Route", "app.get(\"/\", (req,res)=>{})",
     "Declared before any app.use(\"/...\", ...) router mount.",
     {"step": "03", "tag": "E2"}),
])
e = stack(d, r4, [
    ("response", "send", "RESPONSE", "200 Text", "res.send(\"Welcome! Connected to DB...\")",
     "Sent unconditionally - no DB state is read.", {"step": "04", "tag": "E1"}),
])

d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)
d.note_box(878, 456, CW, 168, "What this route does not do", [
    "No auth, no rate limiting, no downstream call, no database read.",
    "The response text is not derived from mongoose.connection.readyState anywhere.",
], "error")

x = band(d, [
    ("E1", "Misleading DB claim", "res.send literal",
     "The text asserts a connected database whether or not connectDB() actually "
     "succeeded at startup - confirmed no connection check exists in this handler."),
    ("E2", "No rate limit on the app root", "declared above apiLimiter mounts",
     "Every other route group sits behind apiLimiter or authLimiter; this one is "
     "reachable at unlimited volume."),
])
refs(d, [
    ((e[0].x, e[0].cy), 852, 0, x[0], "left"),
    ((c[0].right, c[0].cy), 852, 1, x[1], "top"),
])
finish(d, os.path.join("root", "system-api-01-root-detailed.svg"), "SYSTEM-01",
       "Discovered during the repository-wide API coverage gate, not a prior module audit.",
       FOOT)


# ===========================================================================
# SYSTEM-02 - GET /ping
# ===========================================================================
d = Diagram(T, title="GET /ping - detailed implementation workflow",
            subtitle="Level 2 · Firebase capability plus one unauthenticated downstream call · "
            "badges map to the 6 stages in system-api-02-ping-overview.svg")
r1 = d.region(20, 272, "Caller", "App keep-alive or external health check",
              accent="ui", step=1)
r2 = d.region(306, 272, "Inline Handler", "app.js, above every router",
              accent="backend", step=2)
r3 = d.region(592, 272, "Dependency Checks", "Firebase capability + ML-API-02 root probe",
              accent="insights", step=3)
r4 = d.region(878, 272, "Response & Client", "Combined status plus App.js failure toast",
              accent="response", step=4)

a = stack(d, r1, [
    ("ui", "cursor", "CLIENT", "App keepAlive() / monitor", "GET /ping",
     "App calls after splash, then every 10 minutes; external callers also work.", {"step": "01", "tag": "E1"}),
])
b = stack(d, r2, [
    ("backend", "sigma", "HANDLER", "Inline Route", "app.get(\"/ping\", async (req,res)=>{})",
     "The Firebase check runs before the ML try/catch.", {"step": "02"}),
    ("database", "gauge", "CAPABILITY", "Firebase Check", "isFirebaseAvailable()",
     "Maps local Admin initialization to push: up or down.", {"step": "03"}),
    ("insights", "send", "OUTBOUND", "ML Root Call", "axios.get(ML_ROUTE + \"/\")",
     "No Authorization header, no shared secret.", {"step": "03", "tag": "E2"}),
])
c = stack(d, r3, [
    ("database", "key", "LOCAL", "Firebase Admin", "config/firebaseAdmin.js",
     "Lazy guarded initialization; no push message is sent here.", {"step": "03"}),
    ("insights", "chart", "CROSS-REF", "ML-API-02 Handler", "GET / (FastAPI)",
     "Documented separately in the ML Service module.", {"step": "03"}),
])
e = stack(d, r4, [
    ("response", "send", "RESPONSE · OK", "200 JSON", "{success:true, backend:\"up\", ml:\"up\", push}",
     "Only reached if the ML call resolves 2xx.", {"step": "04"}),
    ("error", "alert", "RESPONSE · ERR", "503 JSON", "{success:false, ml:\"down\", push, message:\"...\"}",
     "Network error, timeout and ML 5xx all land here identically.",
     {"step": "04", "tag": "E3"}),
])

d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)
d.note_box(878, 456, CW, 168, "No timeout configured", [
    "Unlike predict-category (5000ms) and generate-description (5000ms), this axios.get",
    "call has no timeout option - a hung ML service hangs this request too.",
], "error")

x = band(d, [
    ("E1", "No auth on the health endpoint itself", "app.get(\"/ping\")",
     "Reachable by anyone; each call causes exactly one outbound request to the ML "
     "service, an unauthenticated amplification path."),
    ("E2", "No service-to-service credential", "axios.get(ML_ROUTE + \"/\")",
     "Consistent with the other four backend->ML call sites documented in ML-FLOW-09 - "
     "this is the fifth confirmed call with the same gap."),
    ("E3", "Error causes are indistinguishable", "catch (err) { ... }",
     "DNS failure, connection refused, timeout and an ML-side 500 all produce the same "
     "{ml: \"down\"} response - no error code or type is surfaced."),
])
refs(d, [
    ((a[0].x, a[0].cy), 300, 0, x[0], "left"),
    ((b[1].right, b[1].cy), 852, 1, x[1], "top"),
    ((e[1].x, e[1].cy), 852, 2, x[2], "top"),
])
finish(d, os.path.join("ping", "system-api-02-ping-detailed.svg"), "SYSTEM-02",
       "The only backend route whose own handler calls into the ML service directly.",
       FOOT)


# ===========================================================================
# SYSTEM-03 - POST /api/device-token
# ===========================================================================
d = Diagram(T, title="POST /api/device-token - detailed implementation workflow",
            subtitle="Level 2 · real functions and middleware · badges map to the 9 "
                     "stages in system-api-03-device-token-overview.svg")
r1 = d.region(20, 272, "Push Permission & Client", "Web or native, raw fetch",
              accent="ui", step=1)
r2 = d.region(306, 272, "API Security", "Middleware chain, in order", accent="auth",
              step=2)
r3 = d.region(592, 272, "Validation & Claim Logic", "deviceRegistration()",
              accent="backend", step=3)
r4 = d.region(878, 272, "Persistence", "DeviceToken model, unique index on token",
              accent="database", step=4)
r5 = d.region(1164, 496, "Response & Consumers", "Reply shape and who reads this later",
              accent="response", step=5)

a = stack(d, r1, [
    ("ui", "cursor", "PERMISSION", "Notification Prompt", "useWebPush / useMobilePush",
     "Browser Notification API or Capacitor PushNotifications.", {"step": "01"}),
    ("frontend", "key", "TOKEN", "FCM Token Obtained", "requestPushToken() / registration",
     "Device-specific push token from the platform.", {"step": "02"}),
    ("frontend", "send", "CLIENT", "Raw fetch POST", "fetch(BASE_URL + \"/api/device-token\")",
     "Bypasses the shared axios instance and its interceptors.",
     {"step": "03", "tag": "E4"}),
])
b = stack(d, r2, [
    ("auth", "gauge", "MIDDLEWARE", "Rate Limiter", "apiLimiter",
     "Shared with every other /api route.", {"step": "04"}),
    ("auth", "shield", "MIDDLEWARE", "Token Validation", "verifyToken()",
     "Bearer JWT required; sets req.userId.", {"step": "04"}),
])
c = stack(d, r3, [
    ("backend", "gears", "CONTROLLER", "Field Validation", "deviceRegistration()",
     "token non-empty string; platform is exactly \"web\" or \"mobile\".",
     {"step": "05", "tag": "E1"}),
    ("database", "save", "CLAIM", "findOneAndUpdate", "{token, userId} -> refresh",
     "Idempotent re-registration for the same user/token pair.", {"step": "06"}),
])
e = stack(d, r4, [
    ("database", "layers", "CREATE", "DeviceToken.create", "only if claim found nothing",
     "userId, token, platform written; timestamps auto-added.", {"step": "07"}),
    ("error", "alert", "COLLISION", "Duplicate Key Check", "err.code === 11000",
     "Token already owned by a different user -> 409, not overwritten.",
     {"step": "07", "tag": "E2"}),
])
grp = d.pill_group(r4.card_x, e[-1].bottom + 6, CW, "unique index: token",
                   [("one token", "one user, enforced by MongoDB"),
                    ("no TTL", "invalid FCM tokens are removed")])
d.path([(e[-1].cx, e[-1].bottom), (grp.cx, grp.y)], "database")

d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)

f0 = d.card(1180, Y0, "response", "send", "RESPONSE", "200 / 409 / 400 / 500",
            "res.status(200).json({message: \"...\"})",
            "The 200 body has no success key, unlike every other error body here.",
            w=464, step="08", tag="E3")
d.handoff(grp, f0, 1157, kind="response", width=T["stroke"]["responsePath"],
          label="HTTP RESPONSE")
d.sub_region(1172, 232, 236, 342, "Not this endpoint", "insights")
LY = 264
g = [d.card(1420, LY + i * PITCH, *sp[:6], **sp[6]) for i, sp in enumerate([
    ("insights", "chart", "CONSUMER", "push.service.js", "sendPush()",
     "Reads DeviceToken rows to deliver notifications later.", {"step": "09"}),
    ("insights", "refresh", "CONSUMER", "retryPush.js cron", "*/15 * * * *",
     "Retries failed sends; not directly coupled to this route.", {"step": "09"}),
])]
d.flow_down(g[0], g[1])
d.path([(g[0].x - 30, f0.bottom), (g[0].x - 30, g[0].y)], "insights",
       width=T["stroke"]["primaryPath"])
d.note_box(1172, 456, 236, 168, "Client inconsistency", [
    "useWebPush only checks res.status === 409; every other non-2xx status is",
    "console.logged with no retry and no user-visible feedback.",
], "error")

x = band(d, [
    ("E1", "No length/format cap on token", "token non-empty check only",
     "Any non-empty string is accepted and stored as-is - no upper bound, no format "
     "validation beyond presence."),
    ("E2", "No proactive expiry", "DeviceToken has no TTL index",
     "push.service.js deletes tokens only after FCM returns an invalid-token code; "
     "uninstalled or permission-revoked devices remain until that send attempt."),
    ("E3", "Success body omits the success flag", "res.status(200).json({message})",
     "Every 400/409/500 body includes success:false; the 200 body does not include "
     "success:true, an inconsistency with the rest of this corpus's convention."),
    ("E4", "Bypasses the shared axios client", "raw fetch, not api.js",
     "Neither hook benefits from the centralized 401/429/409 interceptor documented "
     "for every other frontend API call in this corpus."),
])
refs(d, [
    ((c[0].x, c[0].cy), 604, 0, x[0], "left"),
    ((e[1].right, e[1].cy), 1132, 1, x[1], "top"),
    ((f0.x, f0.bottom), f0.x, 2, x[2], "top"),
    ((a[2].right, a[2].cy), 318, 3, x[3], "top-offset"),
])
finish(d, os.path.join("device-token", "system-api-03-device-token-detailed.svg"), "SYSTEM-03",
       "Zero references existed anywhere in docs/api-workflows/ prior to this document.",
       FOOT)
