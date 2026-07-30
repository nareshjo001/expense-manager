"""
Level 2 detailed diagrams for the whole income module — one file, six outputs.

The six routes share a mount, a middleware pair, an axios client and the complete
absence of Redis, so the region skeleton is built once in `base()` and each section
below states only what is genuinely different about its endpoint. Every card string is
traced to source; nothing is carried over from the expense or budget modules.

Run:  python3 build_income_detailed.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))   # shared engine lives one level up

from workflow_diagram import Diagram, load_tokens   # noqa: E402

T = load_tokens()
L, C = T["layout"], T["canvas"]
Y0, PITCH, CW = L["firstCardY"], L["cardPitch"], L["cardWidth"]
BW, BH, BY = L["bandCardWidth"], L["bandCardHeight"], 982
BX = [40, 309, 578, 847, 1116, 1385]
GUTTER = (894, 902, 910, 918, 926, 934)
SUB_L, SUB_R, SUB_W = 1172, 1416, 236

TOKEN_CARD = ("auth", "key", "AXIOS", "Token Attached", "api.interceptors.request",
              "Adds Authorization: Bearer <token> from localStorage.")
LIMITER_CARD = ("auth", "gauge", "MIDDLEWARE", "Rate Limiter", "apiLimiter",
                "150 req / 15 min. Runs before the router, so keyed by IP.")
VERIFY_CARD = ("auth", "shield", "MIDDLEWARE", "Token Validation", "verifyToken()",
               "jwt.verify + payload check; sets req.userId.")
USER_CARD = ("backend", "user-check", "MONGODB", "User Validation",
             "UserModel.findById(req.userId)",
             "401 when the user record no longer exists.")


def base(title, subtitle, r4_label, r4_sub, r5_label, r5_sub):
    d = Diagram(T, title=title, subtitle=subtitle)
    r1 = d.region(20, 272, "User Interface", "React components", accent="ui", step=1)
    r2 = d.region(306, 272, "Frontend Data Layer", "TanStack + axios client",
                  accent="frontend", step=2)
    r3 = d.region(592, 272, "Backend API", "Express middleware + controller",
                  accent="backend", step=3)
    r4 = d.region(878, 272, r4_label, r4_sub, accent="database", step=4)
    r5 = d.region(1164, 496, r5_label, r5_sub, accent="insights", step=5)
    return d, (r1, r2, r3, r4, r5)


def col(region, i):
    return region.card_x, Y0 + i * PITCH


def stack(d, region, specs):
    """Lay a column of cards out and wire the internal flow."""
    made = []
    for i, sp in enumerate(specs):
        kind, icon, kicker, stage, impl, purpose = sp[:6]
        extra = sp[6] if len(sp) > 6 else {}
        made.append(d.card(*col(region, i), kind, icon, kicker, stage, impl, purpose,
                           **extra))
    for a, b in zip(made, made[1:]):
        d.flow_down(a, b)
    return made


def no_redis_note(d, region, y):
    return d.note_box(region.card_x, y, CW, 126, "No Redis in this module", [
        "This route never calls getCache or setCache — no key, no TTL, no branch.",
        "Every request reaches MongoDB directly.",
    ], "database")


def band(d, cards):
    d.exception_band(20, C["bandTop"], 1640, C["bandBottom"] - C["bandTop"],
                     "Exceptions and Current Limitations")
    return [d.exception_card(BX[i], BY, BW, BH, *c) for i, c in enumerate(cards)]


def refs(d, pairs):
    """pairs: (origin_point, rail_x, gutter_index, target_box, enter)"""
    for pt, rail, gi, tgt, enter in pairs:
        y = GUTTER[gi]
        if enter == "left":
            d.path([pt, (rail, pt[1]), (rail, y), (28, y), (28, tgt.cy), (tgt.x, tgt.cy)],
                   "error", dashed=True)
        elif enter == "top-offset":
            d.path([pt, (rail, pt[1]), (rail, y), (400, y), (400, tgt.y)],
                   "error", dashed=True)
        else:
            d.path([pt, (rail, pt[1]), (rail, y), (tgt.cx, y), (tgt.cx, tgt.y)],
                   "error", dashed=True)


def finish(d, out, api_id, notes):
    svg = d.render(meta_right="BALENISA · Personal Finance Platform",
                   meta_left="docs/api-workflows · %s · Level 2 detailed" % api_id,
                   footer_notes=notes)
    open(os.path.join(HERE, out), "w", encoding="utf-8").write(svg)
    print("wrote", out, len(svg))


FOOT = ("Heavy arrows are region hand-offs; the cyan one is the HTTP response. Light arrows "
        "are steps inside a region. There is no green rail because this module has no Redis.")


# ===========================================================================
# INCOME-01 — GET /income/get
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "GET /income/get — detailed implementation workflow",
    "Level 2 · real functions, middleware and models · badges map to the "
    "9 stages in income-api-01-list-income-overview.svg",
    "Database & Cache", "MongoDB only — no Redis in this module",
    "Frontend State & Rendering", "Client cache and the income modal")

a = stack(d, r1, [
    ("ui", "window", "ROUTE", "Insights Page", "IncomeInsights.js",
     "Holds the period state and mounts the income header.", {"step": "01"}),
    ("ui", "cursor", "TRIGGER", "Open Modal", "setShowIncomeModal(true)",
     "A header button toggles the modal; nothing fetches before that.", {"step": "01"}),
    ("ui", "layout", "COMPONENT", "Income Modal", "IncomeModal.js",
     "Receives isOpen and passes it straight to the query hook.", {"step": "01"}),
])
b = stack(d, r2, [
    ("frontend", "refresh", "TANSTACK", "Gated Query Hook", "useIncomeListQuery(isOpen)",
     "enabled is the modal's open flag, so a closed modal never fetches.",
     {"step": "02"}),
    ("frontend", "key", "CACHE KEY", "Query Key", "queryKeys.income.list()",
     "[\"income\",\"list\"] — a prefix of [\"income\"], so mutations hit it.",
     {"step": "02"}),
    ("frontend", "send", "API CLIENT", "Request Function", "getIncome(signal)",
     "GET /income/get; aborts if the modal closes mid-flight.", {"step": "03"}),
    TOKEN_CARD + ({"step": "03"},),
])
c = stack(d, r3, [
    LIMITER_CARD + ({"step": "04", "tag": "E1"},),
    ("backend", "server", "ROUTER", "Route Match", "income.routes.js",
     "GET /get → verifyToken → getIncome. No validator on reads.", {"step": "04"}),
    VERIFY_CARD + ({"step": "04", "tag": "E2"},),
    ("backend", "gears", "CONTROLLER", "Request Handler", "getIncome()",
     "One try/catch around the user check and the read.",
     {"step": "05", "tag": "E4"}),
])
e = stack(d, r4, [
    USER_CARD + ({"step": "05", "tag": "E3"},),
    ("database", "database", "MONGODB · PRIMARY DATA", "Income Read",
     "IncomeModel.find({ userId })",
     "Every record the user owns, sorted by incomeDate descending.",
     {"step": "06", "tag": "E6"}),
    ("response", "send", "RESPONSE", "200 OK", "res.status(200).json({ … })",
     "{ message, success, data } — full Mongoose docs, not lean.", {"step": "07"}),
])
d.handoff(a[2], b[0], 299); d.handoff(b[3], c[0], 585); d.handoff(c[3], e[0], 871)
no_redis_note(d, r4, e[2].bottom + 22)

f0 = d.card(1180, Y0, "frontend", "refresh", "TANSTACK · CLIENT CACHE", "Query Cache",
            "queryClient (defaultOptions)",
            "staleTime 5 min · gcTime 30 min · retry 1 · no focus refetch.",
            w=464, step="08", tag="E5")
d.handoff(e[2], f0, 1157, kind="response", width=T["stroke"]["responsePath"],
          label="HTTP RESPONSE")
d.sub_region(SUB_L, 232, SUB_W, 342, "Income modal · list", "ui")
d.sub_region(SUB_R, 232, SUB_W, 238, "Not consumed elsewhere", "insights")
LY = 264
g = [d.card(1180, LY + i * PITCH, *sp[:6], **sp[6]) for i, sp in enumerate([
    ("ui", "list", "DERIVED", "Records Array", "listQuery.data?.data ?? []",
     "Falls back to an empty array on any failure.", {"step": "09"}),
    ("ui", "monitor", "UI", "Row Rendering", "income-card",
     "Source, amount, date and the edit/delete buttons.", {"step": "09"}),
    ("ui", "sigma", "FORMAT", "Value Formatting", "formatIncomeAmount()",
     "Non-numeric amounts render as 0 rather than NaN.", {"step": "09"}),
])]
d.flow_down(g[0], g[1]); d.flow_down(g[1], g[2])
d.path([(g[0].right - 30, f0.bottom), (g[0].right - 30, g[0].y)], "ui",
       width=T["stroke"]["primaryPath"])
d.note_box(1420, 268, 224, 232, "Nothing else reads this", [
    "The income list feeds only the modal.",
    "The insight routes query IncomeModel themselves, and neither charts nor the "
    "financial report include income at all.",
], "insights")

x = band(d, [
    ("E1", "429 Too Many Requests", "apiLimiter",
     "More than 150 requests in 15 minutes from the same IP address."),
    ("E2", "401 Unauthorized", "verifyToken()",
     "Missing Bearer header, malformed payload, or expired JWT. The axios interceptor "
     "then calls forceReauth()."),
    ("E3", "401 User does not exist", "UserModel.findById → null",
     "Checked before any income document is read."),
    ("E4", "500 Internal Server Error", "catch (err)",
     "MongoDB failures land here. The response body is generic; the real error is "
     "only logged."),
    ("E5", "Failure looks like empty", "IncomeModal.js",
     "A toast fires, but the list falls back to [] and renders “No income records "
     "found.” — identical to a genuinely empty list."),
    ("E6", "No pagination or projection", "getIncome()",
     "Returns every record ever created, as full Mongoose documents. Payload grows "
     "without bound."),
])
refs(d, [
    ((c[0].right, c[0].cy), 852, 0, x[0], "left"),
    ((c[2].x, c[2].cy), 604, 1, x[1], "top-offset"),
    ((e[0].x, e[0].cy), 890, 2, x[2], "top"),
    ((c[3].cx, c[3].bottom), c[3].cx, 3, x[3], "top"),
    ((f0.right, f0.cy), 1654, 4, x[4], "top"),
    ((e[1].right, e[1].cy), 1132, 5, x[5], "top"),
])
finish(d, "income-api-01-list-income-detailed.svg", "INCOME-01",
       [FOOT, "The query is gated on the modal's open state, so this endpoint is never "
              "called on page load — and its result is not shared with any other view."])


# ===========================================================================
# INCOME-02 — POST /income/add
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "POST /income/add — detailed implementation workflow",
    "Level 2 · real functions, middleware and models · badges map to the "
    "10 stages in income-api-02-add-income-overview.svg",
    "Validation & Database", "Joi guard → MongoDB insert",
    "Frontend Cache & Navigation", "What the client does once the write lands")

a = stack(d, r1, [
    ("ui", "window", "ROUTE", "Entry Point", "AddIncome.js",
     "Standalone form reached from the add menu.", {"step": "01"}),
    ("ui", "layout", "FORM", "Income Form", "source · amount · date",
     "All three inputs are required; amount has min 0 in the markup.",
     {"step": "01"}),
    ("ui", "cursor", "HANDLER", "Submit Handler", "handleSubmit(e)",
     "Trims and collapses whitespace in the source before sending.",
     {"step": "01", "tag": "E6"}),
])
b = stack(d, r2, [
    ("frontend", "refresh", "TANSTACK", "Mutation Hook", "useAddIncomeMutation()",
     "retry 0 by default — a failed write is never re-sent.", {"step": "02"}),
    ("frontend", "send", "MUTATION FN", "Mutation Function", "addIncome(payload)",
     "Amount is coerced with unary +; date is the raw input string.",
     {"step": "02"}),
    ("frontend", "send", "API CLIENT", "Request Function", "api.post('/income/add')",
     "No AbortSignal on mutations.", {"step": "03"}),
    TOKEN_CARD + ({"step": "03"},),
])
c = stack(d, r3, [
    LIMITER_CARD + ({"step": "04", "tag": "E1"},),
    ("backend", "server", "ROUTER", "Route Match", "income.routes.js",
     "POST /add → verifyToken → addIncomeValidation → addIncome.", {"step": "04"}),
    VERIFY_CARD + ({"step": "04", "tag": "E2"},),
    ("auth", "file-text", "MIDDLEWARE", "Field Validation", "addIncomeValidation",
     "Joi: source min 1, amount positive, date parsable. 400 on failure.",
     {"step": "05", "tag": "E4"}),
    ("backend", "gears", "CONTROLLER", "Request Handler", "addIncome()",
     "Runs only after Joi has passed.", {"step": "06", "tag": "E5"}),
])
e = stack(d, r4, [
    USER_CARD + ({"step": "06", "tag": "E3"},),
    ("database", "save", "MONGODB · WRITE", "Income Insert",
     "new IncomeModel(…).save()",
     "userId comes from the token, never from the request body.", {"step": "07"}),
    ("response", "send", "RESPONSE", "201 Created", "res.status(201).json({ … })",
     "{ message, success } — the new record is not returned.", {"step": "08"}),
])
d.handoff(a[2], b[0], 299); d.handoff(b[3], c[0], 585); d.handoff(c[4], e[0], 871)
no_redis_note(d, r4, e[2].bottom + 22)

f0 = d.card(1180, Y0, "frontend", "refresh", "TANSTACK · MUTATION", "Mutation Settled",
            "onSuccess()",
            "Runs before the component callback passed to mutate().",
            w=464, step="09")
d.handoff(e[2], f0, 1157, kind="response", width=T["stroke"]["responsePath"],
          label="HTTP RESPONSE")
d.sub_region(SUB_L, 232, SUB_W, 238, "Query invalidation", "frontend")
d.sub_region(SUB_R, 232, SUB_W, 342, "Component response", "ui")
LY = 264
g = [d.card(1180, LY + i * PITCH, *sp[:6], **sp[6]) for i, sp in enumerate([
    ("frontend", "key", "INVALIDATE", "Income Keys", "queryKeys.income.all",
     "[\"income\"] is a prefix, so list, summary and insights all refetch.",
     {"step": "09"}),
    ("frontend", "key", "INVALIDATE", "Reports", "queryKeys.reports.all",
     "Refetched even though the report pipeline reads no income.", {"step": "09"}),
])]
d.flow_down(g[0], g[1])
h = [d.card(1420, LY + i * PITCH, *sp[:6], **sp[6]) for i, sp in enumerate([
    ("ui", "layout", "RESET", "Form Cleared", "setSource/setAmount/setDate",
     "All three fields are emptied in the component callback.", {"step": "10"}),
    ("ui", "cursor", "ROUTE", "Navigate Home", "navigate('/')",
     "Leaves the form for the expenses page.", {"step": "10"}),
    ("ui", "monitor", "TOAST", "Success Toast", "expenseAddSuccessToast(data)",
     "Shows the server's own message string.", {"step": "10"}),
])]
d.flow_down(h[0], h[1]); d.flow_down(h[1], h[2])
d.path([(g[0].right - 30, f0.bottom), (g[0].right - 30, g[0].y)], "frontend",
       width=T["stroke"]["primaryPath"])
d.path([(h[0].right - 30, f0.bottom), (h[0].right - 30, h[0].y)], "ui",
       width=T["stroke"]["primaryPath"])
d.note_box(1180, 462, 224, 168, "No optimistic update", [
    "Nothing is written into the cache directly and no optimistic entry is added.",
    "The list only changes after the invalidated query refetches.",
], "frontend")

x = band(d, [
    ("E1", "429 Too Many Requests", "apiLimiter",
     "More than 150 requests in 15 minutes from the same IP address."),
    ("E2", "401 Unauthorized", "verifyToken()",
     "Missing Bearer header, malformed payload, or expired JWT."),
    ("E3", "401 User does not exist", "UserModel.findById → null",
     "Checked after Joi has already accepted the payload."),
    ("E4", "400 Field validation", "addIncomeValidation",
     "Joi rejects a blank source, a zero or negative amount, or an unparsable date, "
     "before the controller runs."),
    ("E5", "500 Internal Server Error", "catch (err)",
     "A save failure or schema violation surfaces here with a generic body."),
    ("E6", "Dead field in the payload", "handleSubmit()",
     "An id: Date.now() field is sent and silently dropped — IncomeModel has no such "
     "path and strict mode discards it."),
])
refs(d, [
    ((c[0].right, c[0].cy), 852, 0, x[0], "left"),
    ((c[2].x, c[2].cy), 604, 1, x[1], "top-offset"),
    ((e[0].x, e[0].cy), 890, 2, x[2], "top"),
    ((c[3].right, c[3].cy), 852, 3, x[3], "top"),
    ((c[4].cx, c[4].bottom), c[4].cx, 4, x[4], "top"),
    ((a[2].right, a[2].cy), 280, 5, x[5], "top"),
])
finish(d, "income-api-02-add-income-detailed.svg", "INCOME-02",
       [FOOT, "Validation is middleware here, so an invalid payload never reaches the "
              "controller. The UI updates by invalidation and refetch — never optimistically."])


# ===========================================================================
# INCOME-03 — PUT /income/edit
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "PUT /income/edit — detailed implementation workflow",
    "Level 2 · real functions, middleware and models · badges map to the "
    "10 stages in income-api-03-edit-income-overview.svg",
    "Validation & Database", "Joi guard → scoped MongoDB update",
    "Frontend Cache & Modal", "What the client does once the write lands")

a = stack(d, r1, [
    ("ui", "layout", "COMPONENT", "Income Modal", "IncomeModal.js",
     "Lists the records fetched by INCOME-01.", {"step": "01"}),
    ("ui", "cursor", "TRIGGER", "Edit Pressed", "handleEdit(income)",
     "Seeds the input with the current amount so an untouched save is a no-op.",
     {"step": "01"}),
    ("ui", "cursor", "HANDLER", "Save Changes", "handleSaveChanges()",
     "Sends the input value as-is — a string, not a number.", {"step": "01"}),
])
b = stack(d, r2, [
    ("frontend", "refresh", "TANSTACK", "Mutation Hook", "useUpdateIncomeMutation()",
     "mutationFn destructures { incomeId, newAmount }.", {"step": "02"}),
    ("frontend", "send", "MUTATION FN", "Mutation Function", "updateIncome(id, amount)",
     "Builds the body from the two arguments.", {"step": "02"}),
    ("frontend", "send", "API CLIENT", "Request Function", "api.put('/income/edit')",
     "No AbortSignal on mutations.", {"step": "03"}),
    TOKEN_CARD + ({"step": "03"},),
])
c = stack(d, r3, [
    LIMITER_CARD + ({"step": "04", "tag": "E1"},),
    ("backend", "server", "ROUTER", "Route Match", "income.routes.js",
     "PUT /edit → verifyToken → editIncomeValidation → editIncome.", {"step": "04"}),
    VERIFY_CARD + ({"step": "04", "tag": "E2"},),
    ("auth", "file-text", "MIDDLEWARE", "Field Validation", "editIncomeValidation",
     "Joi: incomeId a string, newAmount strictly positive. 400 on failure.",
     {"step": "05", "tag": "E4"}),
    ("backend", "gears", "CONTROLLER", "Request Handler", "editIncome()",
     "Runs only after Joi has passed.", {"step": "06", "tag": "E6"}),
])
e = stack(d, r4, [
    USER_CARD + ({"step": "06", "tag": "E3"},),
    ("auth", "key", "GUARD", "Id Validation", "mongoose.isValidObjectId()",
     "A malformed id is rejected with 400 before any query runs.", {"step": "06"}),
    ("database", "save", "MONGODB · WRITE", "Scoped Update",
     "findOneAndUpdate({_id, userId})",
     "userId is part of the filter, so cross-account edits cannot match.",
     {"step": "07", "tag": "E5"}),
    ("response", "send", "RESPONSE", "200 OK", "res.status(200).json({ … })",
     "{ message, success } — the updated document is fetched but discarded.",
     {"step": "08"}),
])
d.handoff(a[2], b[0], 299); d.handoff(b[3], c[0], 585); d.handoff(c[4], e[0], 871)
no_redis_note(d, r4, e[3].bottom + 22)

f0 = d.card(1180, Y0, "frontend", "refresh", "TANSTACK · MUTATION", "Mutation Settled",
            "onSuccess()",
            "Runs before the component callback passed to mutate().",
            w=464, step="09")
d.handoff(e[3], f0, 1157, kind="response", width=T["stroke"]["responsePath"],
          label="HTTP RESPONSE")
d.sub_region(SUB_L, 232, SUB_W, 238, "Query invalidation", "frontend")
d.sub_region(SUB_R, 232, SUB_W, 342, "Component response", "ui")
LY = 264
g = [d.card(1180, LY + i * PITCH, *sp[:6], **sp[6]) for i, sp in enumerate([
    ("frontend", "key", "INVALIDATE", "Income Keys", "queryKeys.income.all",
     "[\"income\"] is a prefix, so list, summary and insights all refetch.",
     {"step": "09"}),
    ("frontend", "key", "INVALIDATE", "Reports", "queryKeys.reports.all",
     "Refetched even though the report pipeline reads no income.", {"step": "09"}),
])]
d.flow_down(g[0], g[1])
h = [d.card(1420, LY + i * PITCH, *sp[:6], **sp[6]) for i, sp in enumerate([
    ("ui", "monitor", "TOAST", "Success Toast", "expenseAddSuccessToast()",
     "Fixed client-side string, not the server's message.", {"step": "10"}),
    ("ui", "layout", "STATE", "Editor Closes", "setIsEdit(false)",
     "Clears editIncomeId and the amount input.", {"step": "10"}),
    ("ui", "list", "UI", "Row Updates", "income-card",
     "The new amount appears once the refetch lands.", {"step": "10"}),
])]
d.flow_down(h[0], h[1]); d.flow_down(h[1], h[2])
d.path([(g[0].right - 30, f0.bottom), (g[0].right - 30, g[0].y)], "frontend",
       width=T["stroke"]["primaryPath"])
d.path([(h[0].right - 30, f0.bottom), (h[0].right - 30, h[0].y)], "ui",
       width=T["stroke"]["primaryPath"])
d.note_box(1180, 462, 224, 168, "Amount only", [
    "The controller $sets incomeAmount and nothing else.",
    "Source and date cannot be corrected through this API at all.",
], "frontend")

x = band(d, [
    ("E1", "429 Too Many Requests", "apiLimiter",
     "More than 150 requests in 15 minutes from the same IP address."),
    ("E2", "401 Unauthorized", "verifyToken()",
     "Missing Bearer header, malformed payload, or expired JWT."),
    ("E3", "401 User does not exist", "UserModel.findById → null",
     "Checked before the id is inspected."),
    ("E4", "400 Field validation", "editIncomeValidation · isValidObjectId",
     "Joi rejects a missing id or a non-positive amount; a malformed ObjectId is "
     "rejected separately inside the controller."),
    ("E5", "404 Income not found", "findOneAndUpdate → null",
     "Returned both when the id does not exist and when it belongs to another "
     "account — the two are indistinguishable to the caller."),
    ("E6", "500 Internal Server Error", "catch (err)",
     "A write failure or validator rejection surfaces here with a generic body."),
])
refs(d, [
    ((c[0].right, c[0].cy), 852, 0, x[0], "left"),
    ((c[2].x, c[2].cy), 604, 1, x[1], "top-offset"),
    ((e[0].x, e[0].cy), 890, 2, x[2], "top"),
    ((c[3].right, c[3].cy), 852, 3, x[3], "top"),
    ((e[2].right, e[2].cy), 1132, 4, x[4], "top"),
    ((c[4].cx, c[4].bottom), c[4].cx, 5, x[5], "top"),
])
finish(d, "income-api-03-edit-income-detailed.svg", "INCOME-03",
       [FOOT, "Ownership is enforced inside the update filter rather than by a separate "
              "lookup, so a cross-account edit simply matches nothing and returns 404."])


# ===========================================================================
# INCOME-04 — DELETE /income/delete
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "DELETE /income/delete — detailed implementation workflow",
    "Level 2 · real functions, middleware and models · badges map to the "
    "10 stages in income-api-04-delete-income-overview.svg",
    "Validation & Database", "Inline guards → scoped MongoDB delete",
    "Frontend Cache & Rendering", "What the client does once the delete lands")

a = stack(d, r1, [
    ("ui", "layout", "COMPONENT", "Income Modal", "IncomeModal.js",
     "Lists the records fetched by INCOME-01.", {"step": "01"}),
    ("ui", "cursor", "TRIGGER", "Trash Pressed", "handleDelete(income._id)",
     "Fires the mutation immediately — no dialog, no undo.",
     {"step": "01", "tag": "E6"}),
])
b = stack(d, r2, [
    ("frontend", "refresh", "TANSTACK", "Mutation Hook", "useDeleteIncomeMutation()",
     "mutationFn receives the id directly.", {"step": "02"}),
    ("frontend", "send", "MUTATION FN", "Mutation Function", "deleteIncome(id)",
     "Wraps the id as { deleteIncomeId }.", {"step": "02"}),
    ("frontend", "send", "API CLIENT", "Request Function", "api.delete('/income/delete')",
     "Body travels in the axios data config key.", {"step": "03"}),
    TOKEN_CARD + ({"step": "03"},),
])
c = stack(d, r3, [
    LIMITER_CARD + ({"step": "04", "tag": "E1"},),
    ("backend", "server", "ROUTER", "Route Match", "income.routes.js",
     "DELETE /delete → verifyToken → deleteIncome. No Joi validator.",
     {"step": "04"}),
    VERIFY_CARD + ({"step": "04", "tag": "E2"},),
    ("backend", "gears", "CONTROLLER", "Request Handler", "deleteIncome()",
     "Guards live inline; this route has no validation middleware.",
     {"step": "05", "tag": "E5"}),
])
e = stack(d, r4, [
    USER_CARD + ({"step": "05", "tag": "E3"},),
    ("auth", "key", "GUARD", "Id Validation", "mongoose.isValidObjectId()",
     "A malformed id is rejected with 400 before any query runs.",
     {"step": "06", "tag": "E4"}),
    ("database", "save", "MONGODB · WRITE", "Scoped Delete",
     "findOneAndDelete({_id, userId})",
     "userId is part of the filter, so cross-account deletes cannot match.",
     {"step": "07"}),
    ("response", "send", "RESPONSE", "200 OK", "res.status(200).json({ … })",
     "{ message, success }. 404 when the filter matched nothing.", {"step": "08"}),
])
d.handoff(a[1], b[0], 299); d.handoff(b[3], c[0], 585); d.handoff(c[3], e[0], 871)
no_redis_note(d, r4, e[3].bottom + 22)

f0 = d.card(1180, Y0, "frontend", "refresh", "TANSTACK · MUTATION", "Mutation Settled",
            "onSuccess()",
            "Runs before the component callback passed to mutate().",
            w=464, step="09")
d.handoff(e[3], f0, 1157, kind="response", width=T["stroke"]["responsePath"],
          label="HTTP RESPONSE")
d.sub_region(SUB_L, 232, SUB_W, 238, "Query invalidation", "frontend")
d.sub_region(SUB_R, 232, SUB_W, 238, "Component response", "ui")
LY = 264
g = [d.card(1180, LY + i * PITCH, *sp[:6], **sp[6]) for i, sp in enumerate([
    ("frontend", "key", "INVALIDATE", "Income Keys", "queryKeys.income.all",
     "[\"income\"] is a prefix, so list, summary and insights all refetch.",
     {"step": "09"}),
    ("frontend", "key", "INVALIDATE", "Reports", "queryKeys.reports.all",
     "Refetched even though the report pipeline reads no income.", {"step": "09"}),
])]
d.flow_down(g[0], g[1])
h = [d.card(1420, LY + i * PITCH, *sp[:6], **sp[6]) for i, sp in enumerate([
    ("ui", "monitor", "TOAST", "Success Toast", "if (data.success)",
     "Only fires when the body reports success.", {"step": "10"}),
    ("ui", "list", "UI", "Row Disappears", "income-card",
     "The row is removed only after the refetch resolves.", {"step": "10"}),
])]
d.flow_down(h[0], h[1])
d.path([(g[0].right - 30, f0.bottom), (g[0].right - 30, g[0].y)], "frontend",
       width=T["stroke"]["primaryPath"])
d.path([(h[0].right - 30, f0.bottom), (h[0].right - 30, h[0].y)], "ui",
       width=T["stroke"]["primaryPath"])
d.note_box(1180, 462, 464, 168, "No confirmation and no optimistic removal", [
    "The trash button calls mutate() straight away — there is no dialog, no undo and "
    "no disabled state on the row while the request is in flight.",
    "The row stays visible until the refetch returns, so a slow network looks like "
    "nothing happened.",
], "ui")

x = band(d, [
    ("E1", "429 Too Many Requests", "apiLimiter",
     "More than 150 requests in 15 minutes from the same IP address."),
    ("E2", "401 Unauthorized", "verifyToken()",
     "Missing Bearer header, malformed payload, or expired JWT."),
    ("E3", "401 User does not exist", "UserModel.findById → null",
     "Checked before the id is inspected."),
    ("E4", "400 Invalid income ID", "mongoose.isValidObjectId",
     "A malformed id is rejected before the delete runs. There is no Joi middleware "
     "on this route."),
    ("E5", "404 Income not found", "findOneAndDelete → null",
     "Returned both when the id does not exist and when it belongs to another "
     "account — the two are indistinguishable to the caller."),
    ("E6", "No confirmation step", "IncomeModal.js",
     "A single click deletes. No dialog, no undo, and no optimistic removal to make "
     "the outcome visible before the refetch."),
])
refs(d, [
    ((c[0].right, c[0].cy), 852, 0, x[0], "left"),
    ((c[2].x, c[2].cy), 604, 1, x[1], "top-offset"),
    ((e[0].x, e[0].cy), 890, 2, x[2], "top"),
    ((e[1].right, e[1].cy), 1132, 3, x[3], "top"),
    ((e[2].right, e[2].cy), 1143, 4, x[4], "top"),
    ((a[1].right, a[1].cy), 280, 5, x[5], "top"),
])
finish(d, "income-api-04-delete-income-detailed.svg", "INCOME-04",
       [FOOT, "Ownership is enforced inside the delete filter. The destructive action has no "
              "confirmation step and no optimistic UI, so the row lingers until the refetch."])


# ===========================================================================
# INCOME-05 / INCOME-06 — the two insight reads
# ===========================================================================
def insight_diagram(api_id, out, verb_title, subtitle_stages, handler, agg_card,
                    response_card, consumer_cards, extra_note, band_cards, ref_specs,
                    pills=None, notes_tail=""):
    d, (r1, r2, r3, r4, r5) = base(
        verb_title,
        "Level 2 · real functions, middleware and models · badges map to the "
        "%s in %s" % (subtitle_stages, out.replace("-detailed.svg", "-overview.svg")),
        "Database & Computation", "MongoDB reads → in-process derivation",
        "Frontend State & Rendering", "Client cache and the insights page")

    a = stack(d, r1, [
        ("ui", "window", "ROUTE", "Insights Page", "IncomeInsights.js",
         "Owns the period state, default 'financial_year'.", {"step": "01"}),
        ("ui", "cursor", "STATE", "Period Selector", "setPeriod(value)",
         "Only current_month and financial_year are offered.", {"step": "01"}),
        ("ui", "layout", "COMPONENT", "Consumer Component", consumer_cards["mount"],
         consumer_cards["mount_desc"], {"step": "01"}),
    ])
    b = stack(d, r2, [
        ("frontend", "refresh", "TANSTACK", "Query Hook", consumer_cards["hook"],
         "Period is an argument, so each period is a separate entry.",
         {"step": "02"}),
        ("frontend", "key", "CACHE KEY", "Query Key", consumer_cards["key"],
         "Nested under [\"income\"], so income mutations invalidate it.",
         {"step": "02"}),
        ("frontend", "send", "API CLIENT", "Request Function", consumer_cards["fn"],
         "A read sent as POST, because period travels in the body.", {"step": "03"}),
        TOKEN_CARD + ({"step": "03"},),
    ])
    c = stack(d, r3, [
        LIMITER_CARD + ({"step": "04", "tag": "E1"},),
        ("backend", "server", "ROUTER", "Route Match", "income.routes.js",
         consumer_cards["route"], {"step": "04"}),
        VERIFY_CARD + ({"step": "04", "tag": "E2"},),
        ("backend", "gears", "CONTROLLER", "Request Handler", handler,
         "One try/catch around the guard, both reads and the derivation.",
         {"step": "05", "tag": "E5"}),
    ])
    e_specs = [
        USER_CARD + ({"step": "05", "tag": "E3"},),
        ("auth", "gauge", "GUARD", "Period Resolution", "resolvePeriod(period)",
         "Returns null for anything else, which becomes a 400.",
         {"step": "06", "tag": "E4"}),
        ("database", "database", "MONGODB · PRIMARY DATA", "Parallel Reads",
         "Promise.all([income, expense])",
         "Two independent range queries issued together, not in series.",
         {"step": "07"}),
        agg_card,
        response_card,
    ]
    e = stack(d, r4, e_specs)
    d.handoff(a[2], b[0], 299); d.handoff(b[3], c[0], 585); d.handoff(c[3], e[0], 871)

    if pills:
        grp = d.pill_group(r4.card_x, e[4].bottom + 8, CW, pills[0], pills[1])
        d.path([(e[4].cx, e[4].bottom), (e[4].cx, grp.y)], "insights")
    else:
        no_redis_note(d, r4, e[4].bottom + 20)

    f0 = d.card(1180, Y0, "frontend", "refresh", "TANSTACK · CLIENT CACHE",
                "Query Cache", "queryClient (defaultOptions)",
                "staleTime 5 min · gcTime 30 min · retry 1 · no focus refetch.",
                w=464, step=consumer_cards["cache_step"])
    d.handoff(e[4], f0, 1157, kind="response", width=T["stroke"]["responsePath"],
              label="HTTP RESPONSE")
    d.sub_region(SUB_L, 232, SUB_W, consumer_cards["sub_h"], consumer_cards["sub_label"],
                 "insights")
    d.sub_region(SUB_R, 232, SUB_W, 238, "Sibling route", "ui")
    LY = 264
    g = [d.card(1180, LY + i * PITCH, *sp[:6], **sp[6])
         for i, sp in enumerate(consumer_cards["cards"])]
    for p, q in zip(g, g[1:]):
        d.flow_down(p, q)
    d.path([(g[0].right - 30, f0.bottom), (g[0].right - 30, g[0].y)], "insights",
           width=T["stroke"]["primaryPath"])
    d.note_box(1420, 268, 224, 232, *extra_note)

    x = band(d, band_cards)
    refs(d, [(pt, rail, gi, x[i], enter)
             for i, (pt, rail, gi, enter) in enumerate(ref_specs(a, b, c, e, f0, g))])
    finish(d, out, api_id, [FOOT, notes_tail])


insight_diagram(
    "INCOME-05", "income-api-05-insights-header-detailed.svg",
    "POST /income/insights-header — detailed implementation workflow",
    "10 stages", "getInsightsHeader()",
    ("backend", "sigma", "DERIVE", "Header Aggregation", "reduce over both arrays",
     "Totals, largest source, record count and the balance.",
     {"step": "08", "tag": "E6"}),
    ("response", "send", "RESPONSE", "200 OK", "res.json({ success, data })",
     "Five numbers; topSource falls back to the string \"N/A\".", {"step": "09"}),
    dict(mount="Header.js", mount_desc="Income summary cards above the insight panel.",
         hook="useIncomeSummaryQuery(period)", key="queryKeys.income.summary(period)",
         fn="api.post('/insights-header')",
         route="POST /insights-header → verifyToken → getInsightsHeader.",
         cache_step="09", sub_label="Income header cards", sub_h=342,
         cards=[
             ("frontend", "sigma", "FALLBACK", "Default Card Data", "DEFAULT_CARD_DATA",
              "Zeroed totals and \"N/A\" render until the query resolves.",
              {"step": "10"}),
             ("ui", "monitor", "UI", "Summary Grid", "monthly-insights-header",
              "Total income, total expenses, balance, count and top source.",
              {"step": "10"}),
             ("ui", "cursor", "TRIGGER", "Open Income Modal", "setShowIncomeModal(true)",
              "The same header is the entry point for INCOME-01.", {"step": "10"}),
         ]),
    ("Shared with the card route", [
        "Both insight routes resolve the same period and run the same two range "
        "queries.",
        "They diverge only in what they derive from the results.",
    ], "insights"),
    [("E1", "429 Too Many Requests", "apiLimiter",
      "More than 150 requests in 15 minutes from the same IP address."),
     ("E2", "401 Unauthorized", "verifyToken()",
      "Missing Bearer header, malformed payload, or expired JWT."),
     ("E3", "401 User does not exist", "UserModel.findById → null",
      "Checked before the period is resolved."),
     ("E4", "400 Invalid period", "resolvePeriod → null",
      "Anything other than current_month or financial_year is rejected."),
     ("E5", "500 on a body-less POST", "const { period } = req.body",
      "Express 5 leaves req.body undefined when no body is sent, so destructuring "
      "throws and the catch returns 500 instead of the intended 400."),
     ("E6", "Top source is not the largest", "reduce(…) with no else branch",
      "The callback returns undefined when the comparison fails, which resets the "
      "accumulator. The reported source is effectively the last record.")],
    lambda a, b, c, e, f0, g: [
        ((c[0].right, c[0].cy), 852, 0, "left"),
        ((c[2].x, c[2].cy), 604, 1, "top-offset"),
        ((e[0].x, e[0].cy), 890, 2, "top"),
        ((e[1].right, e[1].cy), 1132, 3, "top"),
        ((c[3].cx, c[3].bottom), c[3].cx, 4, "top"),
        ((e[3].right, e[3].cy), 1143, 5, "top"),
    ],
    notes_tail="This route and INCOME-06 issue the same two queries over the same range; "
               "documenting them separately keeps their different guards and outputs honest.")


insight_diagram(
    "INCOME-06", "income-api-06-insights-card-detailed.svg",
    "POST /income/insights-card — detailed implementation workflow",
    "10 stages", "getInsightsCard()",
    ("insights", "chart", "DERIVE", "Insight Computation", "income.service",
     "Runway, savings rate and income dependency, each independently.",
     {"step": "08"}),
    ("response", "send", "RESPONSE", "200 OK", "res.json({ success, data })",
     "Three objects; each is null when its precondition is unmet.", {"step": "09"}),
    dict(mount="OverallInsight.js", mount_desc="Three insight cards below the header.",
         hook="useIncomeInsightsQuery(period)", key="queryKeys.income.insights(period)",
         fn="api.post('/insights-card')",
         route="POST /insights-card → verifyToken → getInsightsCard.",
         cache_step="09", sub_label="Income insight cards", sub_h=342,
         cards=[
             ("insights", "sigma", "GUARD", "Success Check", "data?.success ? data.data",
              "Anything else collapses to null and hides every card.", {"step": "10"}),
             ("ui", "monitor", "UI", "Card Grid", "overall-insights-container",
              "Savings rate, runway forecast and dependency risk.", {"step": "10"}),
             ("ui", "cursor", "MOTION", "Scroll Reveal", "useInView(threshold 0.5)",
              "Cards animate in once half of the container is visible.",
              {"step": "10", "tag": "E6"}),
         ]),
    ("Nulls are silent", [
        "Runway is null without spend, savings rate is null without income and "
        "dependency is null without records.",
        "A null card simply does not render — there is no empty state.",
    ], "insights"),
    [("E1", "429 Too Many Requests", "apiLimiter",
      "More than 150 requests in 15 minutes from the same IP address."),
     ("E2", "401 Unauthorized", "verifyToken()",
      "Missing Bearer header, malformed payload, or expired JWT."),
     ("E3", "401 User does not exist", "UserModel.findById → null",
      "Checked before the period is resolved."),
     ("E4", "400 Invalid period", "resolvePeriod → null",
      "Anything other than current_month or financial_year is rejected. This handler "
      "guards req.body with || {}, so a body-less POST reaches this 400."),
     ("E5", "500 Internal Server Error", "catch (error)",
      "A read failure surfaces here with a generic body; the real error is logged."),
     ("E6", "Missing cards are invisible", "OverallInsight.js",
      "A null insight renders nothing at all, so a user cannot tell an unmet "
      "precondition from a failed request.")],
    lambda a, b, c, e, f0, g: [
        ((c[0].right, c[0].cy), 852, 0, "left"),
        ((c[2].x, c[2].cy), 604, 1, "top-offset"),
        ((e[0].x, e[0].cy), 890, 2, "top"),
        ((e[1].right, e[1].cy), 1132, 3, "top"),
        ((c[3].cx, c[3].bottom), c[3].cx, 4, "top"),
        ((g[2].right, g[2].cy), 1654, 5, "top"),
    ],
    pills=("one period → three insight objects",
           [("runwayData", "days of balance left"),
            ("savingsRateData", "rate, band, message"),
            ("incomeDependencyData", "top-source share")]),
    notes_tail="Same period resolution and the same two reads as INCOME-05; only the "
               "derivation and the response shape differ.")
