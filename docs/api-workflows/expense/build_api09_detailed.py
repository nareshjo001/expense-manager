"""
API-09 Level 2 — detailed implementation workflow for
GET /expense/expense-edit-data

Created during the repository-wide API coverage gate. Four regions: this route has no
Redis layer and no insights consumer, so it's simpler than API-01/02/03/04's five-region
shape — the fifth region here is the form-hydration hand-off instead.

Run:  python3 build_api09_detailed.py
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
            title="GET /expense/expense-edit-data — detailed implementation workflow",
            subtitle="Level 2 · real functions, middleware and models · badges map to the "
                     "9 stages in api-09-edit-data-overview.svg")

r1 = d.region(20,   272, "Edit Trigger", "AddExpense.js hydration effect",
              accent="ui", step=1)
r2 = d.region(306,  272, "Frontend Data Layer", "Imperative fetchQuery + axios client",
              accent="frontend", step=2)
r3 = d.region(592,  272, "Backend API", "Express middleware + controller",
              accent="backend", step=3)
r4 = d.region(878,  272, "Database", "User check -> ObjectId guard -> scoped read",
              accent="database", step=4)
r5 = d.region(1164, 496, "Form Hydration", "Where the response lands",
              accent="ui", step=5)


def col(region, i):
    return region.card_x, Y0 + i * PITCH


# --- 01 edit trigger ---------------------------------------------------
a1 = d.card(*col(r1, 0), "ui", "cursor", "TRIGGER", "Edit Icon Clicked",
            "isEdit.enableEdit === true",
            "Set by ExpenseItem.js navigating to /add in edit mode.", step="01")
a2 = d.card(*col(r1, 1), "ui", "monitor", "EFFECT", "Hydration useEffect",
            "AddExpense.js",
            "Gated on isEdit.enableEdit && isEdit.expense_id.", step="01")
d.flow_down(a1, a2)

# --- 02 frontend data layer ---------------------------------------------
b1 = d.card(*col(r2, 0), "frontend", "refresh", "IMPERATIVE", "fetchQuery Call",
            "queryClient.fetchQuery({queryKey, queryFn})",
            "Not a mounted useQuery — checks cache, then requests.",
            step="02", tag="E5")
b2 = d.card(*col(r2, 1), "frontend", "send", "API CLIENT", "Request Function",
            "getExpenseEditData(expenseId, signal)",
            "Thin axios wrapper in expenseApi.js.", step="03")
b3 = d.card(*col(r2, 2), "auth", "key", "AXIOS", "Token Attached",
            "api.interceptors.request",
            "Adds Authorization: Bearer <token> from localStorage.", step="03")
d.flow_down(b1, b2); d.flow_down(b2, b3)
d.handoff(a2, b1, 299)

# --- 03 backend api -------------------------------------------------------
c1 = d.card(*col(r3, 0), "auth", "gauge", "MIDDLEWARE", "Rate Limiter", "apiLimiter",
            "150 req / 15 min. Runs before the router, so keyed by IP.",
            step="04", tag="E1")
c2 = d.card(*col(r3, 1), "backend", "server", "ROUTER", "Route Match",
            "expense.routes.js",
            "GET /expense-edit-data -> verifyToken -> geteditexpense.", step="04")
c3 = d.card(*col(r3, 2), "auth", "shield", "MIDDLEWARE", "Token Validation",
            "verifyToken()",
            "jwt.verify + payload check; sets req.userId.", step="04", tag="E2")
c4 = d.card(*col(r3, 3), "backend", "gears", "CONTROLLER", "Request Handler",
            "geteditexpense()",
            "One try/catch around user check, guard and read.", step="05")
d.flow_down(c1, c2); d.flow_down(c2, c3); d.flow_down(c3, c4)
d.handoff(b3, c1, 585)

# --- 04 database -----------------------------------------------------------
e1 = d.card(r4.card_x, Y0, "backend", "user-check", "VALIDATION", "User Validation",
            "UserModel.findById(req.userId)",
            "Runs first. 401 if the token's user no longer exists.",
            step="05", tag="E2")
e2 = d.card(r4.card_x, e1.bottom + 14, "backend", "gauge", "GUARD", "ObjectId Guard",
            "mongoose.Types.ObjectId.isValid(expenseId)",
            "Malformed IDs rejected with 400 before any query.",
            step="06", tag="E3")
e3 = d.card(r4.card_x, e2.bottom + 14, "database", "database", "MONGODB · SCOPED READ",
            "Ownership-Scoped Find", "ExpenseModel.findOne({userId, _id})",
            "Cross-account access is not reachable — userId is always in the filter.",
            step="07", tag="E4")
e4 = d.card(r4.card_x, e3.bottom + 14, "response", "send", "RESPONSE", "200 OK",
            "res.status(200).json({message, data, success})",
            "Raw document returned — no field filtering or projection.", step="08")
d.flow_down(e1, e2); d.flow_down(e2, e3); d.flow_down(e3, e4)
d.handoff(c4, e1, 871)

# --- 05 form hydration -----------------------------------------------------
SUB_L, SUB_W = 1172, 468
f0 = d.card(1180, Y0, "ui", "layout", "HYDRATION", "Five Fields Set",
            "setName / setCategory / setAmount / setDate / setDescription",
            "Every field the create form also owns, populated verbatim.",
            w=464, step="09")
d.handoff(e4, f0, 1157, kind="response", width=T["stroke"]["responsePath"],
          label="HTTP RESPONSE")

d.sub_region(SUB_L, 232, SUB_W, 342, "Side effect on load", "insights")
LY = 264
g1 = d.card(1180, LY, "insights", "key", "REF WRITE", "programmaticNameRef Set",
            "programmaticNameRef.current = exp.expenseName",
            "Suppresses the ML-prediction debounce effect from firing on this "
            "programmatically-loaded name.", step="09")
g2 = d.card(1180, LY + PITCH, "ui", "monitor", "UI", "Spinner Clears",
            "setIsSpinnerLoading(false)",
            "Full-screen overlay, shared with create/update/delete.", step="09")
d.flow_down(g1, g2)
d.path([(g1.x - 30, f0.bottom), (g1.x - 30, g1.y)], "insights",
       width=T["stroke"]["primaryPath"])

# --- exceptions --------------------------------------------------------
d.exception_band(20, C["bandTop"], 1640, C["bandBottom"] - C["bandTop"],
                 "Exceptions and Current Limitations")
BW, BH, BY = L["bandCardWidth"], L["bandCardHeight"], 982
BX = [40, 309, 578, 847, 1116, 1385]

x1 = d.exception_card(BX[0], BY, BW, BH, "E1", "429 Too Many Requests", "apiLimiter",
                      "More than 150 requests in 15 minutes from the same IP address.")
x2 = d.exception_card(BX[1], BY, BW, BH, "E2", "401 Unauthorized / user missing",
                      "verifyToken() / UserModel.findById",
                      "Missing/expired JWT, or the token's user no longer exists in the "
                      "database.")
x3 = d.exception_card(BX[2], BY, BW, BH, "E3", "400 Invalid expense ID",
                      "ObjectId.isValid(expenseId)",
                      "A malformed expenseId is rejected before any query runs — no "
                      "database round trip is wasted.")
x4 = d.exception_card(BX[3], BY, BW, BH, "E4", "404 Expense not found",
                      "findOne({userId, _id}) -> null",
                      "A valid ObjectId that doesn't belong to this user returns 404, not "
                      "403 — the same non-existence response as a truly missing ID.")
x5 = d.exception_card(BX[4], BY, BW, BH, "E5", "Every failure is console-only",
                      "AddExpense.js catch block",
                      "400/404/500 all land in a single console.error; no toast, no retry "
                      "affordance, form stays blank with no visual indication.")

d.path([(c1.right, c1.cy), (852, c1.cy), (852, 894), (28, 894), (28, x1.cy),
        (x1.x, x1.cy)], "error", dashed=True)
d.path([(e1.x, e1.cy), (890, e1.cy), (890, 902), (400, 902), (400, x2.y)],
       "error", dashed=True)
d.path([(e2.x, e2.cy), (890, e2.cy), (890, 910), (x3.cx, 910), (x3.cx, x3.y)],
       "error", dashed=True)
d.path([(e3.right, e3.cy), (1132, e3.cy), (1132, 918), (x4.cx, 918), (x4.cx, x4.y)],
       "error", dashed=True)
d.path([(1412, f0.bottom), (1412, 926), (x5.cx, 926), (x5.cx, x5.y)],
       "error", dashed=True)

svg = d.render(
    meta_right="BALENISA · Personal Finance Platform",
    meta_left="docs/api-workflows · API-09 · Level 2 detailed",
    footer_notes=[
        "Heavy arrows are region hand-offs; the cyan one is the HTTP response. Light arrows are steps inside a region.",
        "No Redis layer exists on this route. The hydration call is imperative (fetchQuery), not a mounted useQuery hook.",
    ])
open(os.path.join(HERE, "api-09-edit-data-detailed.svg"), "w",
     encoding="utf-8").write(svg)
print("wrote api-09-edit-data-detailed.svg", len(svg), "bytes")
