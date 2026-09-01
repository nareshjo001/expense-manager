"""Verified Level 2 route diagrams for SIA. Run: python build_sia_detailed.py"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from workflow_diagram import Diagram, load_tokens  # noqa: E402

T = load_tokens()
L, C = T["layout"], T["canvas"]
Y0, PITCH = L["firstCardY"], L["cardPitch"]
REGIONS = [(20, 272, "SIA User Interface", "Initiator", "ui"),
           (306, 272, "Frontend Data Layer", "Authenticated API client", "frontend"),
           (592, 272, "Security & Controller", "Middleware then handler", "auth"),
           (878, 272, "SIA Service Boundary", "Route-specific work", "backend"),
           (1164, 496, "Response Boundary", "Safe public contract", "response")]

ROUTES = [
    ("sia-api-01-ask", "ask", "POST /sia/ask", "SiaPanel", "askSia()", "siaLimiter", "ask()",
     "readiness → validate → keyed reservation → current snapshot → direct answer → grounding validation", "matching completed request replays; provider/grounding failure is generic 503"),
    ("sia-api-02-status", "status", "GET /sia/status", "SiaEntryPoint", "getSiaStatus()", "no SIA limiter", "status()",
     "local text/voice readiness and safe capability limits", "no provider, financial snapshot, reservation, or session operation"),
    ("sia-api-03-sessions-list", "sessions-list", "GET /sia/sessions", "SiaSessionList", "getSiaSessions()", "siaLimiter", "listSessions()",
     "sessionService.listSessions(req.userId, { limit })", "storage failure returns generic 503"),
    ("sia-api-04-session-messages", "session-messages", "GET /sia/sessions/:sessionId/messages", "SiaSessionList", "getSiaSessionMessages()", "siaLimiter", "listMessages()",
     "owner-scoped paginated messages and stored grounding", "unknown and foreign ids share the same 404"),
    ("sia-api-05-session-delete", "session-delete", "DELETE /sia/sessions/:sessionId", "SiaSessionList", "deleteSiaSession()", "siaLimiter", "deleteSession()",
     "owner-scoped conversation deletion", "only conversation data is deleted"),
    ("sia-api-06-transcriptions", "transcriptions", "POST /sia/transcriptions", "SiaVoiceRecorderControls", "transcribeSiaAudio()", "siaVoiceLimiter + readiness + multer", "transcribe()",
     "validate hints → byte-signature detection → transcription provider", "audio remains request-memory only; no answer/session/ML call"),
]


def card(d, r, index, kind, icon, kicker, stage, impl, purpose, step, tag=None):
    extra = {"step": step}
    if tag: extra["tag"] = tag
    return d.card(r.card_x, Y0 + index * PITCH, kind, icon, kicker, stage, impl, purpose, **extra)


for identifier, folder, endpoint, ui, client, limiter, handler, work, boundary in ROUTES:
    d = Diagram(T, title=f"{endpoint} — detailed implementation workflow",
                subtitle="Level 2 · verified middleware, controller, and service boundary")
    regions = [d.region(x, w, label, subtitle, accent=accent, step=i + 1)
               for i, (x, w, label, subtitle, accent) in enumerate(REGIONS)]
    a = card(d, regions[0], 0, "ui", "layout", "COMPONENT", "Route Initiated", ui,
             "User-facing SIA action.", "01")
    b = card(d, regions[1], 0, "frontend", "send", "API CLIENT", "Authenticated Request", client,
             "The shared interceptor supplies the bearer token.", "02")
    c1 = card(d, regions[2], 0, "auth", "shield", "MIDDLEWARE", "Identity", "verifyToken()",
              "Sets req.userId; client identity is never read from body/query.", "03")
    c2 = card(d, regions[2], 1, "auth", "gauge", "MIDDLEWARE", "Route Guard", limiter,
              "Runs before the controller's route-specific work.", "03")
    s = card(d, regions[3], 0, "backend", "gears", "CONTROLLER", "Verified Work", handler,
             work, "04")
    r = card(d, regions[4], 0, "response", "send", "RESPONSE", "Safe Contract", "200 / controlled error",
             "Never exposes provider credentials, stack traces, or another user's data.", "05")
    d.handoff(a, b, 299); d.handoff(b, c1, 585); d.flow_down(c1, c2); d.handoff(c2, s, 871)
    d.handoff(s, r, 1157, kind="response", width=T["stroke"]["responsePath"], label="HTTP RESPONSE")
    d.note_box(regions[4].card_x, r.bottom + 18, regions[4].w - 2 * L["regionPaddingX"], 166,
               "Route boundary", [boundary], "insights")
    d.exception_band(20, C["bandTop"], 1640, C["bandBottom"] - C["bandTop"], "Exceptions and Current Limitations")
    d.exception_card(40, 982, L["bandCardWidth"], L["bandCardHeight"], "E1", "Authentication / rate guard", limiter,
                     "Rejected requests do not reach the route controller.")
    d.exception_card(309, 982, L["bandCardWidth"], L["bandCardHeight"], "E2", "Safe failure response", handler,
                     boundary)
    svg = d.render(meta_right="BALENISA · Personal Finance Platform",
                   meta_left=f"docs/api-workflows · {identifier.upper()} · Level 2 detailed",
                   footer_notes=["Heavy arrows are region hand-offs; cyan is the HTTP response. Detailed work is limited to code this route actually invokes."])
    path = os.path.join(HERE, folder, f"{identifier}-detailed.svg")
    open(path, "w", encoding="utf-8").write(svg)
    print("wrote", os.path.relpath(path, HERE))
