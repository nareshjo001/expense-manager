"""
BUDGET-01 Level 2 — detailed implementation workflow for GET /api/getbudgets

Same region grid, card treatment, connector hierarchy and exception band as the
Expense set. One layer is genuinely absent and is drawn as an explicit absence:
getbudgets never calls getCache or setCache, so region 04 has no cache decision,
no short-circuit rail and no TTL.

Run:  python3 build_budget01_detailed.py
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
            title="GET /api/getbudgets — detailed implementation workflow",
            subtitle="Level 2 · real functions, middleware and models · badges map to the "
                     "10 stages in budget-api-01-get-budgets-overview.svg")

r1 = d.region(20,   272, "User Interface", "Two independent mount points",
              accent="ui", step=1)
r2 = d.region(306,  272, "Frontend Data Layer", "TanStack Query + axios client",
              accent="frontend", step=2)
r3 = d.region(592,  272, "Backend API", "Express middleware + controller",
              accent="backend", step=3)
r4 = d.region(878,  272, "Database & Cache", "MongoDB only — no Redis on this route",
              accent="database", step=4)
r5 = d.region(1164, 496, "Frontend Cache & Consumers",
              "Client cache and the two budget consumers",
              accent="insights", step=5)


def col(region, i):
    return region.card_x, Y0 + i * PITCH


# --- 01 user interface -----------------------------------------------------
a1 = d.card(*col(r1, 0), "ui", "window", "ROUTE", "Entry Point",
            "LandingPage.js · Route '/'",
            "ExpensesPage is the default authenticated view.", step="01")
a2 = d.card(*col(r1, 1), "ui", "layout", "COMPONENT", "Budget Panel",
            "SetBudget.js",
            "Rendered at the top of ExpensesPage on every visit.", step="01")
a3 = d.card(*col(r1, 2), "ui", "layout", "COMPONENT", "Insights Header",
            "Header.js",
            "Second, independent consumer on the insights page.", step="01")
d.flow_down(a1, a2); d.flow_down(a2, a3)

# --- 02 frontend data layer ------------------------------------------------
b1 = d.card(*col(r2, 0), "frontend", "refresh", "TANSTACK", "Query Hook",
            "useBudgetsQuery()",
            "No options set — inherits the global query defaults.", step="02")
b2 = d.card(*col(r2, 1), "frontend", "key", "CACHE KEY", "Query Key",
            "queryKeys.budgets.all",
            "[\"budgets\"] — one entry shared by both consumers.", step="02")
b3 = d.card(*col(r2, 2), "frontend", "send", "API CLIENT", "Request Function",
            "getBudgets(signal)",
            "GET /api/getbudgets; aborts on unmount.", step="03")
b4 = d.card(*col(r2, 3), "auth", "key", "AXIOS", "Token Attached",
            "api.interceptors.request",
            "Adds Authorization: Bearer <token> from localStorage.", step="03")
d.flow_down(b1, b2); d.flow_down(b2, b3); d.flow_down(b3, b4)
d.handoff(a3, b1, 299)

# --- 03 backend api --------------------------------------------------------
c1 = d.card(*col(r3, 0), "auth", "gauge", "MIDDLEWARE", "Rate Limiter", "apiLimiter",
            "150 req / 15 min. Runs before the router, so keyed by IP.",
            step="04", tag="E1")
c2 = d.card(*col(r3, 1), "backend", "server", "ROUTER", "Route Match",
            "api.routes.js",
            "GET /getbudgets → verifyToken → getbudgets. No validator.", step="04")
c3 = d.card(*col(r3, 2), "auth", "shield", "MIDDLEWARE", "Token Validation",
            "verifyToken()",
            "jwt.verify + payload check; sets req.userId.", step="04", tag="E2")
c4 = d.card(*col(r3, 3), "backend", "gears", "CONTROLLER", "Request Handler",
            "getbudgets()",
            "One try/catch around the user check and the read.",
            step="05", tag="E4")
d.flow_down(c1, c2); d.flow_down(c2, c3); d.flow_down(c3, c4)
d.handoff(b4, c1, 585)

# --- 04 database (no cache layer) ------------------------------------------
e1 = d.card(r4.card_x, Y0, "backend", "user-check", "MONGODB", "User Validation",
            "UserModel.findById(req.userId)",
            "401 when the user record no longer exists.", step="05", tag="E3")
e2 = d.card(r4.card_x, e1.bottom + 14, "database", "database", "MONGODB · PRIMARY DATA",
            "Budget Read", "BudgetModel.find({ userId })",
            "Every month the user owns. No filter, no projection.", step="06")
e3 = d.card(r4.card_x, e2.bottom + 14, "backend", "layers", "TRANSFORM",
            "Chronological Sort", "sortByMonthKey",
            "Splits the \"Mon YYYY\" key, then orders by year and month.", step="06")
e4 = d.card(r4.card_x, e3.bottom + 14, "response", "send", "RESPONSE", "200 OK",
            "res.status(200).json({ … })",
            "{ message, data, success } — data is the full history.", step="07")
d.flow_down(e1, e2); d.flow_down(e2, e3); d.flow_down(e3, e4)
d.handoff(c4, e1, 871)

d.note_box(r4.card_x, e4.bottom + 22, CW, 150, "No server cache on this route", [
    "getbudgets never calls getCache or setCache, so there is no key, no TTL and "
    "no hit/miss branch.",
    "clearUserExpenseCache does not touch budgets either — nothing budget-shaped "
    "is ever stored in Redis.",
], "database")

# --- 05 frontend cache and the two consumers -------------------------------
SUB_L, SUB_R, SUB_W_L, SUB_W_R = 1172, 1416, 236, 232
f0 = d.card(1180, Y0, "frontend", "refresh", "TANSTACK · CLIENT CACHE", "Query Cache",
            "queryClient (defaultOptions)",
            "staleTime 5 min · gcTime 30 min · retry 1 · no focus refetch.",
            w=464, step="08")
d.handoff(e4, f0, 1157, kind="response", width=T["stroke"]["responsePath"],
          label="HTTP RESPONSE")

d.sub_region(SUB_L, 232, SUB_W_L, 342, "Budget panel · ExpensesPage", "ui")
d.sub_region(SUB_R, 232, SUB_W_R, 238, "Insights header", "insights")

LY = 264
g1 = d.card(1180, LY + 0 * PITCH, "frontend", "sigma", "DERIVED", "Budget Summary",
            "useBudgetSummary()",
            "Maps the list to status plus this month's total.",
            step="08", tag="E5")
g2 = d.card(1180, LY + 1 * PITCH, "ui", "key", "MATCH", "Current-Month Match",
            "format(new Date(),'MMM yyyy')",
            "String compare against each stored month key.", step="09")
g3 = d.card(1180, LY + 2 * PITCH, "ui", "chart", "UI", "Budget Bar",
            "<BudgetBar/>",
            "Percentage fill, tooltip and over-budget alert state.", step="09")
d.flow_down(g1, g2); d.flow_down(g2, g3)

h1 = d.card(1420, LY + 0 * PITCH, "ui", "monitor", "UI", "Header Card",
            "Header.js",
            "Reads only totalBudget from the same summary hook.", step="10")
h2 = d.card(1420, LY + 1 * PITCH, "ui", "sigma", "FIGURE", "Budget Figure",
            "₹ {totalBudget}",
            "Shown twice — summary card and edit modal.", step="10", tag="E6")
d.flow_down(h1, h2)

d.path([(g1.right - 30, f0.bottom), (g1.right - 30, g1.y)], "frontend", width=T["stroke"]["primaryPath"])
d.path([(h1.right - 30, f0.bottom), (h1.right - 30, h1.y)], "ui", width=T["stroke"]["primaryPath"])

d.note_box(1420, 494, 224, 168, "Two month-key sources", [
    "useBudgetSummary builds its key with toLocaleString, which follows the "
    "browser locale.",
    "SetBudget and BudgetBar build theirs with date-fns format, which is always "
    "English. The backend uses a third.",
], "insights")

# --- exceptions ------------------------------------------------------------
d.exception_band(20, C["bandTop"], 1640, C["bandBottom"] - C["bandTop"],
                 "Exceptions and Current Limitations")
BW, BH, BY = L["bandCardWidth"], L["bandCardHeight"], 982
BX = [40, 309, 578, 847, 1116, 1385]

x1 = d.exception_card(BX[0], BY, BW, BH, "E1", "429 Too Many Requests", "apiLimiter",
                      "More than 150 requests in 15 minutes from the same IP address.")
x2 = d.exception_card(BX[1], BY, BW, BH, "E2", "401 Unauthorized", "verifyToken()",
                      "Missing Bearer header, malformed payload, or expired JWT. The axios "
                      "interceptor then calls forceReauth().")
x3 = d.exception_card(BX[2], BY, BW, BH, "E3", "401 User does not exist",
                      "UserModel.findById → null",
                      "Checked before any budget document is read.")
x4 = d.exception_card(BX[3], BY, BW, BH, "E4", "500 Internal Server Error", "catch (err)",
                      "MongoDB failures land here. The response body is generic; the real "
                      "error is only logged.")
x5 = d.exception_card(BX[4], BY, BW, BH, "E5", "Handled: “Network Error”",
                      "useBudgetSummary → SetBudget",
                      "budgetStatus becomes 'error' on isError or success === false, and "
                      "the panel renders a distinct message rather than an empty state.")
x6 = d.exception_card(BX[5], BY, BW, BH, "E6", "Unhandled: header shows ₹ 0",
                      "Header.js",
                      "Header destructures totalBudget only and never reads budgetStatus, "
                      "so a failed load is indistinguishable from a zero budget.")

d.path([(c1.right, c1.cy), (852, c1.cy), (852, 894), (28, 894), (28, x1.cy),
        (x1.x, x1.cy)], "error", dashed=True)
d.path([(c3.x, c3.cy), (604, c3.cy), (604, 902), (400, 902), (400, x2.y)],
       "error", dashed=True)
d.path([(e1.x, e1.cy), (890, e1.cy), (890, 910), (x3.cx, 910), (x3.cx, x3.y)],
       "error", dashed=True)
d.path([(c4.cx, c4.bottom), (c4.cx, 918), (x4.cx, 918), (x4.cx, x4.y)],
       "error", dashed=True)
d.path([(g1.right, g1.cy), (1412, g1.cy), (1412, 926), (x5.cx, 926), (x5.cx, x5.y)],
       "error", dashed=True)
d.path([(h2.right, h2.cy), (1654, h2.cy), (1654, 934), (x6.cx, 934), (x6.cx, x6.y)],
       "error", dashed=True)

svg = d.render(
    meta_right="BALENISA · Personal Finance Platform",
    meta_left="docs/api-workflows · BUDGET-01 · Level 2 detailed",
    footer_notes=[
        "Heavy arrows are region hand-offs; the cyan one is the HTTP response. Light arrows are steps inside a region. There is no green rail because this route has no Redis.",
        "One request, two independent consumers. The budget panel surfaces load failures; the insights header does not — see E5 and E6.",
    ])
open(os.path.join(HERE, "get-budgets", "budget-api-01-get-budgets-detailed.svg"), "w",
     encoding="utf-8").write(svg)
print("wrote budget-api-01-get-budgets-detailed.svg", len(svg), "bytes")
