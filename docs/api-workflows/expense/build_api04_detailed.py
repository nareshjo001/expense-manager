"""
API-04 Level 2 — detailed implementation workflow for
GET /expense/search?startDate&endDate

Same region grid, card treatment, connector hierarchy and exception band as API-01.
Two layers are genuinely absent and are drawn as explicit absences rather than
omitted silently:

  * no Redis — getByCustom never calls getCache or setCache, so region 04 has no
    cache decision, no short-circuit rail and no cache write;
  * no insights — the ExpensesPage effect only notifies the insights engine for
    filter '' and 'bycategory', so region 05 has a single consumer.

Run:  python3 build_api04_detailed.py
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
            title="GET /expense/search — detailed implementation workflow",
            subtitle="Level 2 · real functions, middleware and models · badges map to the "
                     "10 stages in api-04-custom-range-overview.svg")

r1 = d.region(20,   272, "User Interface", "React route + range modal",
              accent="ui", step=1)
r2 = d.region(306,  272, "Frontend Data Layer", "TanStack Query + axios client",
              accent="frontend", step=2)
r3 = d.region(592,  272, "Backend API", "Express middleware + controller",
              accent="backend", step=3)
r4 = d.region(878,  272, "Database & Cache", "MongoDB only — no Redis on this route",
              accent="database", step=4)
r5 = d.region(1164, 496, "Frontend Insights & Rendering",
              "Client cache and list rendering only",
              accent="insights", step=5)


def col(region, i):
    return region.card_x, Y0 + i * PITCH


# --- 01 user interface -----------------------------------------------------
a1 = d.card(*col(r1, 0), "ui", "window", "ROUTE", "Entry Point",
            "LandingPage.js · Route '/'",
            "ExpensesPage is the default authenticated view.", step="01")
a2 = d.card(*col(r1, 1), "ui", "cursor", "STATE", "Filter Selection",
            "filter === 'custom'",
            "Chosen from the Filter By select; clears any prior insight.", step="01")
a3 = d.card(*col(r1, 2), "ui", "layout", "MODAL", "Date Range Modal",
            "custom-range-modal",
            "Two date inputs; stays open until both dates are set.", step="01")
a4 = d.card(*col(r1, 3), "ui", "layout", "COMPONENT", "Page Component",
            "ExpensesPage.js",
            "Owns startDate/endDate and calls the expenses query hook.", step="01")
d.flow_down(a1, a2); d.flow_down(a2, a3); d.flow_down(a3, a4)

# --- 02 frontend data layer ------------------------------------------------
b1 = d.card(*col(r2, 0), "frontend", "refresh", "TANSTACK", "Query Hook",
            "useExpensesQuery(filter, …)",
            "Mode 'custom'; enabled: false until both dates exist.", step="02")
b2 = d.card(*col(r2, 1), "frontend", "key", "CACHE KEY", "Query Key",
            "queryKeys.expenses.list()",
            "{mode:\"custom\",startDate,endDate} — a key per range.", step="02")
b3 = d.card(*col(r2, 2), "frontend", "send", "API CLIENT", "Request Function",
            "searchExpenses(start, end)",
            "Sends both dates as query params; aborts on unmount.", step="03")
b4 = d.card(*col(r2, 3), "auth", "key", "AXIOS", "Token Attached",
            "api.interceptors.request",
            "Adds Authorization: Bearer <token> from localStorage.", step="03")
d.flow_down(b1, b2); d.flow_down(b2, b3); d.flow_down(b3, b4)
d.handoff(a4, b1, 299)

# --- 03 backend api --------------------------------------------------------
c1 = d.card(*col(r3, 0), "auth", "gauge", "MIDDLEWARE", "Rate Limiter", "apiLimiter",
            "150 req / 15 min. Runs before the router, so keyed by IP.",
            step="04", tag="E1")
c2 = d.card(*col(r3, 1), "backend", "server", "ROUTER", "Route Match",
            "expense.routes.js",
            "GET /search → verifyToken → getByCustom.", step="04")
c3 = d.card(*col(r3, 2), "auth", "shield", "MIDDLEWARE", "Token Validation",
            "verifyToken()",
            "jwt.verify + payload check; sets req.userId.", step="04", tag="E2")
c4 = d.card(*col(r3, 3), "backend", "gears", "CONTROLLER", "Request Handler",
            "getByCustom()",
            "One try/catch around validation and the range read.",
            step="05", tag="E5")
d.flow_down(c1, c2); d.flow_down(c2, c3); d.flow_down(c3, c4)
d.handoff(b4, c1, 585)

# --- 04 database (no cache layer) ------------------------------------------
e1 = d.card(r4.card_x, Y0, "backend", "user-check", "MONGODB", "User Validation",
            "UserModel.findById(req.userId)",
            "401 when the user record no longer exists.", step="05", tag="E3")
e2 = d.card(r4.card_x, e1.bottom + 14, "auth", "shield", "GUARD", "Parameter Validation",
            "isNaN(new Date(param))",
            "400 if either date is missing, then 400 if either is unparsable.",
            step="05", tag="E4")
e3 = d.card(r4.card_x, e2.bottom + 14, "database", "database", "MONGODB · PRIMARY DATA",
            "Range Query", "ExpenseModel.find(…).lean()",
            "Caller-supplied bounds, inclusive. Read on every request.", step="06")
e4 = d.card(r4.card_x, e3.bottom + 14, "backend", "layers", "TRANSFORM",
            "Response Preparation", "sortAscending(expenses)",
            "Oldest to newest — the opposite order to every other view.", step="07")
e5 = d.card(r4.card_x, e4.bottom + 14, "response", "send", "RESPONSE", "200 OK",
            "res.status(200).json({ … })",
            "{ message, data, success } — nothing is written back.", step="08")
d.flow_down(e1, e2); d.flow_down(e2, e3); d.flow_down(e3, e4); d.flow_down(e4, e5)
d.handoff(c4, e1, 871)

d.note_box(r4.card_x, e5.bottom + 22, CW, 132, "No server cache on this route", [
    "getByCustom never calls getCache or setCache, so there is no cache decision, "
    "no short-circuit and no TTL.",
    "Every request reaches MongoDB, bounded only by the IP rate limit.",
], "database")

# --- 05 frontend: client cache and list rendering only ---------------------
SUB_L, SUB_R, SUB_W = 1172, 1416, 236
f0 = d.card(1180, Y0, "frontend", "refresh", "TANSTACK · CLIENT CACHE", "Query Cache",
            "queryClient (defaultOptions)",
            "staleTime 5 min · gcTime 30 min · retry 1 · no focus refetch.",
            w=464, step="09", tag="E6")
d.handoff(e5, f0, 1157, kind="response", width=T["stroke"]["responsePath"],
          label="HTTP RESPONSE")

d.sub_region(SUB_L, 232, SUB_W, 300, "Insights engine · not invoked", "insights")
d.sub_region(SUB_R, 232, SUB_W, 342, "Expense list", "ui")

d.note_box(1180, 268, 220, 252, "Why nothing runs here", [
    "The ExpensesPage effect only calls the insights engine for filter '' and "
    "filter 'bycategory'.",
    "Switching to 'custom' also calls clearExpenseInsights(), so no Spending "
    "Overview card is rendered.",
], "insights")

LY = 264
h1 = d.card(1420, LY + 0 * PITCH, "ui", "list", "GROUPING", "Range Label",
            "formatDateRange(start, end)",
            "One group keyed by a short human label for the range.", step="10")
h2 = d.card(1420, LY + 1 * PITCH, "ui", "sigma", "TOTAL", "Range Total",
            "reduce(expenseAmount)",
            "Rendered as Total ₹… beneath the single group.", step="10")
h3 = d.card(1420, LY + 2 * PITCH, "ui", "monitor", "UI", "Expense Rows",
            "<ExpenseItem/>",
            "One animated row per expense, oldest first.", step="10")
d.flow_down(h1, h2); d.flow_down(h2, h3)
d.path([(h1.right - 30, f0.bottom), (h1.right - 30, h1.y)], "ui", width=T["stroke"]["primaryPath"])

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
                      "Checked before the date parameters are read.")
x4 = d.exception_card(BX[3], BY, BW, BH, "E4", "400 Bad range parameters",
                      "getByCustom() guards",
                      "Either date missing → “startDate and endDate are required”. "
                      "Either unparsable → “must be valid dates”.")
x5 = d.exception_card(BX[4], BY, BW, BH, "E5", "500 Internal Server Error", "catch (err)",
                      "MongoDB failures land here. The response body is generic; the real "
                      "error is only logged.")
x6 = d.exception_card(BX[5], BY, BW, BH, "E6", "Rendered as an empty result",
                      "ExpensesPage.js",
                      "No isError branch. data is undefined → grouping is empty → "
                      "“No Expenses”, identical to a range with no expenses.")

d.path([(c1.right, c1.cy), (852, c1.cy), (852, 894), (28, 894), (28, x1.cy),
        (x1.x, x1.cy)], "error", dashed=True)
d.path([(c3.x, c3.cy), (604, c3.cy), (604, 902), (400, 902), (400, x2.y)],
       "error", dashed=True)
d.path([(e1.x, e1.cy), (890, e1.cy), (890, 910), (x3.cx, 910), (x3.cx, x3.y)],
       "error", dashed=True)
d.path([(e2.right, e2.cy), (1132, e2.cy), (1132, 918), (x4.cx, 918), (x4.cx, x4.y)],
       "error", dashed=True)
d.path([(c4.cx, c4.bottom), (c4.cx, 926), (x5.cx, 926), (x5.cx, x5.y)],
       "error", dashed=True)
d.path([(1412, f0.bottom), (1412, 934), (x6.cx, 934), (x6.cx, x6.y)],
       "error", dashed=True)

svg = d.render(
    meta_right="BALENISA · Personal Finance Platform",
    meta_left="docs/api-workflows · API-04 · Level 2 detailed",
    footer_notes=[
        "Heavy arrows are region hand-offs; the cyan one is the HTTP response. Light arrows are steps inside a region. There is no green rail because this route has no Redis.",
        "Ten stages, not twelve. The cache decision and the insights consumer are absent from the implementation, so they are shown as explicit absences rather than omitted.",
    ])
open(os.path.join(HERE, "api-04-custom-range-detailed.svg"), "w",
     encoding="utf-8").write(svg)
print("wrote api-04-custom-range-detailed.svg", len(svg), "bytes")
