"""Verified Level 1 route overviews for SIA. Run: python build_sia_overviews.py"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from workflow_diagram import Overview, load_tokens  # noqa: E402


ROUTES = [
    ("sia-api-01-ask", "ask", "POST /sia/ask", "verifyToken → siaLimiter → ask",
     "SiaPanel / askSia", "Readiness → validate → idempotency reservation → direct answer", "provider response is grounding-validated before return"),
    ("sia-api-02-status", "status", "GET /sia/status", "verifyToken → status",
     "SiaEntryPoint / getSiaStatus", "Local readiness and safe voice capability read", "no provider, financial-data, session, or reservation work"),
    ("sia-api-03-sessions-list", "sessions-list", "GET /sia/sessions", "verifyToken → siaLimiter → listSessions",
     "SiaSessionList", "Owner-scoped bounded session list", "storage failure is a generic 503"),
    ("sia-api-04-session-messages", "session-messages", "GET /sia/sessions/:sessionId/messages", "verifyToken → siaLimiter → listMessages",
     "SiaSessionList", "Owner-scoped paginated messages and stored grounding", "unknown and foreign sessions share 404"),
    ("sia-api-05-session-delete", "session-delete", "DELETE /sia/sessions/:sessionId", "verifyToken → siaLimiter → deleteSession",
     "SiaSessionList", "Owner-scoped conversation deletion only", "never deletes financial data"),
    ("sia-api-06-transcriptions", "transcriptions", "POST /sia/transcriptions", "verifyToken → siaVoiceLimiter → readiness → upload → transcribe",
     "SiaVoiceRecorderControls", "Memory upload → signature check → speech-to-text provider", "never invokes answer/session/ML paths"),
]


def write_route(identifier, folder, endpoint, middleware, client, flow, safety):
    o = Overview(load_tokens(), title=f"{endpoint} — SIA workflow",
                 subtitle="Verified Level 1 route flow · see docs/api-workflows/sia/README.md")
    d, row = o.d, o.ROW1
    d.facts_panel(34, 276, 836, 280, "At a glance", [
        ("Route", endpoint, "response"), ("Middleware", middleware, "auth"),
        ("Identity", "req.userId from verifyToken", "auth"), ("Boundary", safety, "insights"),
    ])
    cards = [
        o.card(0, row, "ui", "layout", "01", "SIA UI", client, "Initiates the authenticated request."),
        o.card(1, row, "frontend", "send", "02", "API client", "siaApi / session / voice API", "Bearer token interceptor attaches identity."),
        o.card(2, row, "auth", "shield", "03", "Authentication", "verifyToken", "Sets the trusted user identity."),
        o.card(3, row, "auth", "gauge", "04", "Route guard", middleware, "Route-specific rate/readiness/upload checks."),
        o.card(4, row, "backend", "gears", "05", "Controller", flow, "Performs only this route's verified work."),
        o.card(5, row, "database", "database", "06", "Owned data boundary", "SIA services", "Uses owner-scoped state where this route needs it."),
        o.card(6, row, "response", "send", "07", "Response", "success or safe failure", "No provider internals or secrets exposed."),
    ]
    o.chain(cards, o.R1_CY)
    d.note_box(882, 276, 516, 168, "Verified safety boundary", [safety], "insights")
    svg = o.render(["This overview is route-specific. Shared SIA internals are documented only where the route calls them."], identifier.upper())
    path = os.path.join(HERE, folder, f"{identifier}-overview.svg")
    open(path, "w", encoding="utf-8").write(svg)
    print("wrote", os.path.relpath(path, HERE))


for route in ROUTES:
    write_route(*route)
