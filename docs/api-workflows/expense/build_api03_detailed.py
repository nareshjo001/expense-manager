"""
API-03 Level 2 — detailed implementation workflow for
GET /expense/by-category  (default / yearly branch)

Same controller as API-02, taken through its ELSE branch. The backend only
special-cases `period === 'thismonth'`; anything else — including the UI's
'thisyear' and a missing period — falls through to the calendar-year path, which
never builds the three-month history.

Run:  python3 build_api03_detailed.py
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
            title="GET /expense/by-category — detailed implementation workflow (yearly branch)",
            subtitle="Level 2 · real functions, middleware and models · badges map to the "
                     "12 stages in api-03-category-thisyear-overview.svg")

r1 = d.region(20,   272, "User Interface", "React route + page component",
              accent="ui", step=1)
r2 = d.region(306,  272, "Frontend Data Layer", "TanStack Query + axios client",
              accent="frontend", step=2)
r3 = d.region(592,  272, "Backend API", "Express middleware + controller",
              accent="backend", step=3)
r4 = d.region(878,  272, "Database & Cache", "User check → Redis → MongoDB",
              accent="database", step=4)
r5 = d.region(1164, 496, "Frontend Insights & Rendering",
              "Client cache, insights engine, category rendering",
              accent="insights", step=5)


def col(region, i):
    return region.card_x, Y0 + i * PITCH


# --- 01 user interface -----------------------------------------------------
a1 = d.card(*col(r1, 0), "ui", "window", "ROUTE", "Entry Point",
            "LandingPage.js · Route '/'",
            "ExpensesPage is the default authenticated view.", step="01")
a2 = d.card(*col(r1, 1), "ui", "cursor", "STATE", "Filter Selection",
            "filter === 'bycategory'",
            "Chosen from the Filter By select; clears any prior insight.", step="01")
a3 = d.card(*col(r1, 2), "ui", "cursor", "STATE", "Period Selection",
            "period === 'thisyear'",
            "Any value other than 'thismonth' takes the else branch.", step="01")
a4 = d.card(*col(r1, 3), "ui", "layout", "COMPONENT", "Page Component",
            "ExpensesPage.js",
            "Holds both selects and calls the expenses query hook.", step="01")
d.flow_down(a1, a2); d.flow_down(a2, a3); d.flow_down(a3, a4)

# --- 02 frontend data layer ------------------------------------------------
b1 = d.card(*col(r2, 0), "frontend", "refresh", "TANSTACK", "Query Hook",
            "useExpensesQuery(filter, …)",
            "Mode 'category'; enabled only once period is set.", step="02")
b2 = d.card(*col(r2, 1), "frontend", "key", "CACHE KEY", "Query Key",
            "queryKeys.expenses.list()",
            "{mode:\"category\",period} — period is part of the key.", step="02")
b3 = d.card(*col(r2, 2), "frontend", "send", "API CLIENT", "Request Function",
            "getExpensesByCategory(period)",
            "Sends period as a query param; aborts on unmount.", step="03")
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
            "GET /by-category → verifyToken → getByCategory.", step="04")
c3 = d.card(*col(r3, 2), "auth", "shield", "MIDDLEWARE", "Token Validation",
            "verifyToken()",
            "jwt.verify + payload check; sets req.userId.", step="04", tag="E2")
c4 = d.card(*col(r3, 3), "backend", "gears", "CONTROLLER", "Request Handler",
            "getByCategory()",
            "One try/catch around the whole cache + query path.",
            step="05", tag="E4")
d.flow_down(c1, c2); d.flow_down(c2, c3); d.flow_down(c3, c4)
d.handoff(b4, c1, 585)

# --- 04 database & cache ---------------------------------------------------
e1 = d.card(r4.card_x, Y0, "backend", "user-check", "MONGODB", "User Validation",
            "UserModel.findById(req.userId)",
            "Runs FIRST here — before any cache read. 401 if missing.",
            step="05", tag="E3")
e2 = d.card(r4.card_x, e1.bottom + 14, "database", "bolt", "REDIS · SERVER CACHE",
            "Cache Lookup", "getCache(category:<id>:period)",
            "Key is `category:${userId}:${period || 'year'}`. 300 s TTL.",
            h=112, step="06", tag="E5",
            branches=[("HIT → 200 cached", "database"), ("MISS → continue", "backend")])
e3 = d.card(r4.card_x, e2.bottom + 14, "database", "database", "MONGODB · PRIMARY DATA",
            "Calendar Year Query", "ExpenseModel.find(…).lean()",
            "Jan 1 to Dec 31 of the current year. No history lookback.", step="07")
e4 = d.card(r4.card_x, e3.bottom + 14, "backend", "layers", "TRANSFORM",
            "Dataset Organization", "groupByCategoryHelper()",
            "Sort newest first, then group by category. No monthly pass.", step="08")
grp = d.pill_group(r4.card_x, e4.bottom + 6, CW, "one query → two datasets",
                   [("data", "the year, by category"),
                    ("pastThreeMonths", "[] — never filled here")])
e5 = d.card(r4.card_x, grp.bottom + 14, "database", "save", "REDIS", "Cache Write",
            "setCache(key, payload, 300)",
            "Payload plus the empty history array, for five minutes.",
            step="09", tag="E5")
e6 = d.card(r4.card_x, e5.bottom + 14, "response", "send", "RESPONSE", "200 OK",
            "res.status(200).json({ … })",
            "{ message, data, pastThreeMonths: [], success }", step="09")

d.flow_down(e1, e2); d.flow_down(e2, e3); d.flow_down(e3, e4)
d.path([(e4.cx, e4.bottom), (e4.cx, grp.y)], "database")
d.path([(grp.cx, grp.bottom), (grp.cx, e5.y)], "database")
d.flow_down(e5, e6)
d.handoff(c4, e1, 871)

HIT_RAIL = 1132
d.path([(e2.right, e2.y + 100), (HIT_RAIL, e2.y + 100), (HIT_RAIL, e5.bottom + 5),
        (e6.cx + 66, e5.bottom + 5), (e6.cx + 66, e6.y)],
       "database", width=T["stroke"]["branchPath"],
       label="CACHE HIT", label_at=(HIT_RAIL, 500), label_rotate=True)

# --- 05 frontend insights & rendering --------------------------------------
SUB_L, SUB_R, SUB_W = 1172, 1416, 236
f0 = d.card(1180, Y0, "frontend", "refresh", "TANSTACK · CLIENT CACHE", "Query Cache",
            "queryClient (defaultOptions)",
            "staleTime 5 min · gcTime 30 min · retry 1 · no focus refetch.",
            w=464, step="10", tag="E6")
d.handoff(e6, f0, 1157, kind="response", width=T["stroke"]["responsePath"],
          label="HTTP RESPONSE")

d.sub_region(SUB_L, 232, SUB_W, 652, "Insights engine · client-side", "insights")
d.sub_region(SUB_R, 232, SUB_W, 342, "Category list", "ui")

LY = 264
g1 = d.card(1180, LY + 0 * PITCH, "insights", "chart", "TRIGGER", "Insight Notification",
            "notifyFilterApplied()",
            "Fires on each success while filter is 'bycategory'.", step="11")
g2 = d.card(1180, LY + 1 * PITCH, "insights", "gears", "RULE", "Category Totals",
            "categorySpend()",
            "Totals every category, then finds the highest share.", step="11")
g3 = d.card(1180, LY + 2 * PITCH, "insights", "sigma", "DOMINANCE", "Dominance Level",
            "findTopAndDominantCategory()",
            "Strong ≥ 40 %, Moderate 25–40 %, otherwise Balanced.", step="11")
g4 = d.card(1180, LY + 3 * PITCH, "insights", "chart", "OPTIONAL", "Yearly Stability",
            "yearlyCategoryStablity()",
            "Counts months where the top category is ≥ 20 % of that month.", step="11")
g5 = d.card(1180, LY + 4 * PITCH, "insights", "layers", "OPTIONAL", "Concentration",
            "yearlyCategoryConcentration()",
            "Top two combined: High ≥ 67 %, Moderate ≥ 52 %, else dropped.", step="11")
g6 = d.card(1180, LY + 5 * PITCH, "ui", "monitor", "UI", "Insight Card",
            "THIS_YEAR_CATEGORY_SUMMARY",
            "Template output rendered by <InlineExpenseInsight/>.", step="11")
for a, b in ((g1, g2), (g2, g3), (g3, g4), (g4, g5), (g5, g6)):
    d.flow_down(a, b)

h1 = d.card(1420, LY + 0 * PITCH, "ui", "list", "GROUPING", "Category Grouping",
            "groupedExpenses",
            "The response object is used directly, key = category.", step="12")
h2 = d.card(1420, LY + 1 * PITCH, "ui", "sigma", "TOTAL", "Per-Category Totals",
            "categoryTotals",
            "One reduce per category, rendered under each block.", step="12")
h3 = d.card(1420, LY + 2 * PITCH, "ui", "monitor", "UI", "Expense Rows",
            "<ExpenseItem/>",
            "One animated row per expense inside each category.", step="12")
d.flow_down(h1, h2); d.flow_down(h2, h3)

d.path([(g1.right - 30, f0.bottom), (g1.right - 30, g1.y)], "insights", width=T["stroke"]["primaryPath"])
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
                      "Checked before the cache read, so a stale cache can never answer "
                      "for a deleted user.")
x4 = d.exception_card(BX[3], BY, BW, BH, "E4", "500 Internal Server Error", "catch (err)",
                      "MongoDB failures land here. The response body is generic; the real "
                      "error is only logged.")
x5 = d.exception_card(BX[4], BY, BW, BH, "E5", "Redis unavailable",
                      "getCache() and setCache()",
                      "Both helpers catch and log their own errors. A failed read degrades "
                      "to a miss; a failed write leaves nothing cached. Neither surfaces.")
x6 = d.exception_card(BX[5], BY, BW, BH, "E6", "Rendered as an empty result",
                      "ExpensesPage.js",
                      "No isError branch. data is undefined → grouping is empty → "
                      "“No Expenses”, identical to a genuinely empty year.")

d.path([(c1.right, c1.cy), (852, c1.cy), (852, 894), (28, 894), (28, x1.cy),
        (x1.x, x1.cy)], "error", dashed=True)
d.path([(c3.x, c3.cy), (604, c3.cy), (604, 902), (400, 902), (400, x2.y)],
       "error", dashed=True)
d.path([(e1.x, e1.cy), (890, e1.cy), (890, 910), (x3.cx, 910), (x3.cx, x3.y)],
       "error", dashed=True)
d.path([(c4.cx, c4.bottom), (c4.cx, 918), (x4.cx, 918), (x4.cx, x4.y)],
       "error", dashed=True)
d.path([(e2.right, e2.y + 32), (1143, e2.y + 32), (1143, 926), (x5.cx, 926),
        (x5.cx, x5.y)], "error", dashed=True)
d.path([(1412, f0.bottom), (1412, 934), (x6.cx, 934), (x6.cx, x6.y)],
       "error", dashed=True)

svg = d.render(
    meta_right="BALENISA · Personal Finance Platform",
    meta_left="docs/api-workflows · BRANCH-01 · Level 2 detailed",
    footer_notes=[
        "Heavy arrows are region hand-offs; the cyan one is the HTTP response. Light arrows are steps inside a region. The green rail is the Redis short-circuit.",
        "Same route, same controller as API-02 — a response branch, not a separate endpoint. Only the date window, the transform pass and the insight rules differ.",
    ])
open(os.path.join(HERE, "api-03-category-thisyear-detailed.svg"), "w",
     encoding="utf-8").write(svg)
print("wrote api-03-category-thisyear-detailed.svg", len(svg), "bytes")
