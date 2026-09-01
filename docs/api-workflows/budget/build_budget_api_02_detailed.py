"""
BUDGET-02 Level 2 — detailed implementation workflow for POST /api/setbudget

Same region grid, card treatment, connector hierarchy and exception band as the
Expense set. Budget documents are never cached in Redis; the only Redis traffic on
this route is the report cache, invalidated and repopulated as a side effect.

Run:  python3 build_budget02_detailed.py
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
            title="POST /api/setbudget — detailed implementation workflow",
            subtitle="Level 2 · real functions, middleware and models · badges map to the "
                     "11 stages in budget-api-02-set-budget-overview.svg")

r1 = d.region(20,   272, "User Interface", "Budget panel on the expenses page",
              accent="ui", step=1)
r2 = d.region(306,  272, "Frontend Data Layer", "TanStack mutation + axios client",
              accent="frontend", step=2)
r3 = d.region(592,  272, "Backend API", "Express middleware + controller",
              accent="backend", step=3)
r4 = d.region(878,  272, "Validation, Database & Cache", "Guards → MongoDB writes → report",
              accent="database", step=4)
r5 = d.region(1164, 496, "Frontend Cache Invalidation",
              "What the client refreshes once the write lands",
              accent="insights", step=5)


def col(region, i):
    return region.card_x, Y0 + i * PITCH


# --- 01 user interface -----------------------------------------------------
a1 = d.card(*col(r1, 0), "ui", "window", "ROUTE", "Entry Point",
            "LandingPage.js · Route '/'",
            "ExpensesPage is the default authenticated view.", step="01")
a2 = d.card(*col(r1, 1), "ui", "layout", "COMPONENT", "Budget Panel",
            "SetBudget.js",
            "The form appears only when this month has no budget yet.", step="01")
a3 = d.card(*col(r1, 2), "ui", "cursor", "HANDLER", "Submit Handler",
            "handleBudgetSubmit()",
            "Confirm stays disabled until the entered amount is above 0.", step="01")
d.flow_down(a1, a2); d.flow_down(a2, a3)

# --- 02 frontend data layer ------------------------------------------------
b1 = d.card(*col(r2, 0), "frontend", "refresh", "TANSTACK", "Mutation Hook",
            "useCreateBudgetMutation()",
            "retry 0 by default — a failed write is never re-sent.", step="02")
b2 = d.card(*col(r2, 1), "frontend", "send", "MUTATION FN", "Mutation Function",
            "setBudget(budget)",
            "Sends Number(budget.budgetAmount) as the whole body.", step="02")
b3 = d.card(*col(r2, 2), "frontend", "send", "API CLIENT", "Request Function",
            "api.post('/api/setbudget')",
            "Body is { budget }. No AbortSignal on mutations.", step="03")
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
            "POST /setbudget → verifyToken → setbudget. No validator.", step="04")
c3 = d.card(*col(r3, 2), "auth", "shield", "MIDDLEWARE", "Token Validation",
            "verifyToken()",
            "jwt.verify + payload check; sets req.userId.", step="04", tag="E2")
c4 = d.card(*col(r3, 3), "backend", "gears", "CONTROLLER", "Request Handler",
            "setbudget()",
            "One try/catch around validation, reservation, write and sync.",
            step="05", tag="E5")
d.flow_down(c1, c2); d.flow_down(c2, c3); d.flow_down(c3, c4)
d.handoff(b4, c1, 585)

# --- 04 guards, writes and the report cache --------------------------------
e1 = d.card(r4.card_x, Y0, "backend", "user-check", "MONGODB", "User Validation",
            "UserModel.findById(req.userId)",
            "401 when the user record no longer exists.", step="05", tag="E3")
e2 = d.card(r4.card_x, e1.bottom + 14, "auth", "shield", "GUARD", "Amount Validation",
            "Number.isFinite(budget)",
            "Rejects blank, non-numeric, NaN, Infinity and negatives.",
            step="06", tag="E4")
e3 = d.card(r4.card_x, e2.bottom + 14, "database", "save", "MONGODB · WRITE",
            "Recovery Reservation", "syncRecoveryService.reserve()",
            "Creates durable recovery evidence before the primary write.",
            step="07", tag="E6")
e4 = d.card(r4.card_x, e3.bottom + 14, "database", "sigma", "MONGODB · AGGREGATE",
            "Budget Upsert", "BudgetModel.findOneAndUpdate",
            "Upserts the current-month budget amount.", step="08")
e5 = d.card(r4.card_x, e4.bottom + 14, "database", "bolt", "REDIS + MONGODB",
            "Fenced Synchronization", "synchronizeAfterMutation()",
            "Recalculates derived data and returns recovery status.", step="09")
e6 = d.card(r4.card_x, e5.bottom + 14, "response", "send", "RESPONSE", "200 OK",
            "res.status(200).json({ … })",
            "{ message, success, derivedData } — no budget document is returned.", step="10")
d.flow_down(e1, e2); d.flow_down(e2, e3); d.flow_down(e3, e4)
d.flow_down(e4, e5); d.flow_down(e5, e6)
d.handoff(c4, e1, 871)

d.note_box(r4.card_x, e6.bottom + 18, CW, 126, "Recoverable derived-data synchronization", [
    "Reservation precedes the upsert; synchronization is fenced by its revision.",
    "derivedData reports whether follow-up repair remains pending.",
], "database")

# --- 05 what the client refreshes ------------------------------------------
SUB_L, SUB_R, SUB_W = 1172, 1416, 236
f0 = d.card(1180, Y0, "frontend", "refresh", "TANSTACK · MUTATION", "Mutation Settled",
            "onSuccess()",
            "Runs before the component callback passed to mutate().",
            w=464, step="11")
d.handoff(e6, f0, 1157, kind="response", width=T["stroke"]["responsePath"],
          label="HTTP RESPONSE")

d.sub_region(SUB_L, 232, SUB_W, 342, "Query invalidation", "frontend")
d.sub_region(SUB_R, 232, SUB_W, 238, "Component response", "ui")

LY = 264
g1 = d.card(1180, LY + 0 * PITCH, "frontend", "key", "INVALIDATE", "Budgets",
            "queryKeys.budgets.all",
            "Forces a refetch of GET /api/getbudgets.", step="11")
g2 = d.card(1180, LY + 1 * PITCH, "frontend", "key", "INVALIDATE", "Reports",
            "queryKeys.reports.all",
            "The monthly-insights report is fetched again.", step="11")
g3 = d.card(1180, LY + 2 * PITCH, "frontend", "key", "INVALIDATE", "Charts",
            "queryKeys.charts.all",
            "Budget-versus-spent pie data is fetched again.", step="11")
d.flow_down(g1, g2); d.flow_down(g2, g3)

h1 = d.card(1420, LY + 0 * PITCH, "ui", "monitor", "TOAST", "Success Toast",
            "expenseAddSuccessToast()",
            "Fires from the component callback only if data.success.", step="11")
h2 = d.card(1420, LY + 1 * PITCH, "ui", "chart", "UI", "Budget Bar",
            "<BudgetBar/>",
            "Re-renders once the refetched budget list arrives.", step="11")
d.flow_down(h1, h2)

d.path([(g1.right - 30, f0.bottom), (g1.right - 30, g1.y)], "frontend", width=T["stroke"]["primaryPath"])
d.path([(h1.right - 30, f0.bottom), (h1.right - 30, h1.y)], "ui", width=T["stroke"]["primaryPath"])

d.note_box(1420, 494, 224, 152, "Not invalidated", [
    "queryKeys.expenses.all is deliberately left alone — changing a budget does "
    "not alter any expense list.",
    "The reverse is not true: expense mutations do invalidate budgets.",
], "ui")

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
                      "Checked before the amount is inspected.")
x4 = d.exception_card(BX[3], BY, BW, BH, "E4", "400 Invalid budget amount",
                      "setbudget() guards",
                      "Blank or wrong type → “Budget amount is required”. NaN, Infinity or "
                      "negative → “must be a valid, non-negative number”.")
x5 = d.exception_card(BX[4], BY, BW, BH, "E5", "500 Internal Server Error", "catch (err)",
                      "Mongo write failures, a duplicate-key race on {userId, month}, or a "
                      "report-generation failure all surface here.")
x6 = d.exception_card(BX[5], BY, BW, BH, "E6", "Partial write on failure",
                      "no transaction",
                      "If the recalculation or the report refresh throws, the budget row is "
                      "already changed but spent and the report stay stale.")

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
d.path([(e3.right, e3.cy), (1143, e3.cy), (1143, 934), (x6.cx, 934), (x6.cx, x6.y)],
       "error", dashed=True)

svg = d.render(
    meta_right="BALENISA · Personal Finance Platform",
    meta_left="docs/api-workflows · BUDGET-02 · Level 2 detailed",
    footer_notes=[
        "Heavy arrows are region hand-offs; the cyan one is the HTTP response. Light arrows are steps inside a region. There is no green rail because budgets are never cached in Redis.",
        "The only Redis traffic on this route is the report cache (report:<userId>, 1 h TTL), invalidated and repopulated by refreshReport as a side effect of the write.",
    ])
open(os.path.join(HERE, "set-budget", "budget-api-02-set-budget-detailed.svg"), "w",
     encoding="utf-8").write(svg)
print("wrote budget-api-02-set-budget-detailed.svg", len(svg), "bytes")
