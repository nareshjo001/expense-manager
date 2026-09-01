"""
Level 2 detailed diagrams for the Expense mutation set — one file, six outputs.

All four mutation endpoints share a mount, a middleware pair and one axios client, so the
region skeleton is built once in `base()`. Every card string is traced to source. Where a
layer is absent — validation on PUT, cache invalidation on PATCH — the absence is drawn
explicitly as a note or listed in the exception band; it is never drawn as if implemented.

Run:  python3 build_expense_mutations_detailed.py
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

LIMITER_CARD = ("auth", "gauge", "MIDDLEWARE", "Rate Limiter", "apiLimiter",
                "150 req / 15 min. Runs before the router, so keyed by IP.")
VERIFY_CARD = ("auth", "shield", "MIDDLEWARE", "Token Validation", "verifyToken()",
               "jwt.verify + payload check; sets req.userId.")
USER_CARD = ("backend", "user-check", "MONGODB", "User Validation",
             "UserModel.findById(req.userId)",
             "401 when the user record no longer exists.")
TOKEN_CARD = ("auth", "key", "AXIOS", "Token Attached", "api.interceptors.request",
              "Adds Authorization: Bearer <token> from localStorage.")

FOOT = ("Heavy arrows are region hand-offs; the cyan one is the HTTP response. Light arrows "
        "are steps inside a region. A layer that does not exist is drawn as a note or listed "
        "in the band — never as an implemented step.")

BAND_401 = ("E2", "401 Unauthorized", "verifyToken()",
            "Missing Bearer header, malformed payload, or expired JWT. The axios "
            "interceptor then calls forceReauth().")
BAND_429 = ("E1", "429 Too Many Requests", "apiLimiter",
            "More than 150 requests in 15 minutes from the same IP address.")


def base(title, subtitle, labels):
    d = Diagram(T, title=title, subtitle=subtitle)
    r = []
    for i, (x, w, lab, sub, accent) in enumerate(labels):
        r.append(d.region(x, w, lab, sub, accent=accent, step=i + 1))
    return d, r


def col(region, i):
    return region.card_x, Y0 + i * PITCH


def stack(d, region, specs):
    made = []
    for i, sp in enumerate(specs):
        kind, icon, kicker, stage, impl, purpose = sp[:6]
        extra = sp[6] if len(sp) > 6 else {}
        made.append(d.card(*col(region, i), kind, icon, kicker, stage, impl, purpose,
                           **extra))
    for a, b in zip(made, made[1:]):
        d.flow_down(a, b)
    return made


def band(d, cards):
    d.exception_band(20, C["bandTop"], 1640, C["bandBottom"] - C["bandTop"],
                     "Exceptions and Current Limitations")
    return [d.exception_card(BX[i], BY, BW, BH, *c) for i, c in enumerate(cards)]


def refs(d, pairs):
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


def finish(d, out, api_id, tail):
    svg = d.render(meta_right="BALENISA · Personal Finance Platform",
                   meta_left="docs/api-workflows · %s · Level 2 detailed" % api_id,
                   footer_notes=[FOOT, tail])
    folders = {"api-05": "create", "api-06": "update", "api-07": "delete", "api-08": "toggle-recurring", "flow-01": "flow", "flow-02": "flow"}
    folder = next(value for key, value in folders.items() if out.startswith(key))
    open(os.path.join(HERE, folder, out), "w", encoding="utf-8").write(svg)
    print("wrote", out, len(svg))


def region5(d, src, head, left_label, left, right_label, right, note):
    """HTTP response hand-off, a wide summary card, two sub-columns and a note."""
    f0 = d.card(1180, Y0, *head[:6], w=464, **head[6])
    d.handoff(src, f0, 1157, kind="response", width=T["stroke"]["responsePath"],
              label="HTTP RESPONSE")
    lh = 104 + len(left) * PITCH
    rh = 104 + len(right) * PITCH
    d.sub_region(SUB_L, 232, SUB_W, lh, left_label, "frontend")
    d.sub_region(SUB_R, 232, SUB_W, rh, right_label, "ui")
    LY = 264
    g = [d.card(1180, LY + i * PITCH, *sp[:6], **sp[6]) for i, sp in enumerate(left)]
    for p, q in zip(g, g[1:]):
        d.flow_down(p, q)
    h = [d.card(1420, LY + i * PITCH, *sp[:6], **sp[6]) for i, sp in enumerate(right)]
    for p, q in zip(h, h[1:]):
        d.flow_down(p, q)
    d.path([(g[0].right - 30, f0.bottom), (g[0].right - 30, g[0].y)], "frontend",
           width=T["stroke"]["primaryPath"])
    d.path([(h[0].right - 30, f0.bottom), (h[0].right - 30, h[0].y)], "ui",
           width=T["stroke"]["primaryPath"])
    d.note_box(1420, 232 + max(lh, rh) + 16, 224, 190, *note)
    return f0, g, h


REGIONS_WRITE = lambda r3, r3s, r4, r4s: [
    (20, 272, "User & Expense Interface", "Form, fields, client cleanup", "ui"),
    (306, 272, "Mutation & Network", "TanStack mutation + axios client", "frontend"),
    (592, 272, r3, r3s, "auth"),
    (878, 272, r4, r4s, "database"),
    (1164, 496, "Cache Invalidation & UI", "Server cache, query cache, screen", "insights"),
]


# ===========================================================================
# API-05 — POST /expense/add-expense
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "POST /expense/add-expense — detailed implementation workflow",
    "Level 2 · real functions, middleware and models · badges map to the 11 stages in "
    "api-05-create-expense-overview.svg",
    REGIONS_WRITE("Security & Validation", "Middleware chain, in order",
                  "MongoDB & Propagation", "One insert, three follow-ups"))

a = stack(d, r1, [
    ("ui", "layout", "COMPONENT", "Add Expense Form", "AddExpense.js",
     "One component serves both create and edit modes.", {"step": "01"}),
    ("ui", "cursor", "INPUT", "Five Form Fields", "required + maxLength",
     "Category capped at 20, description at 25; name uncapped.",
     {"step": "01", "tag": "E5"}),
    ("ui", "sigma", "NORMALISE", "Text Cleanup", "sanitizeText()",
     "Trims, then collapses every run of whitespace.", {"step": "02"}),
    ("ui", "sigma", "NORMALISE", "Category Case", "normalizeCategory()",
     "Title-cases each word boundary before sending.",
     {"step": "02", "tag": "E6"}),
])
b = stack(d, r2, [
    ("frontend", "layers", "STATE", "Local Form State", "useState x 5",
     "Plain component state — no Context, no query cache.", {"step": "02"}),
    ("frontend", "refresh", "TANSTACK", "Create Mutation", "useAddExpenseMutation()",
     "Mutations default to retry 0, so a failure never resends.", {"step": "03"}),
    ("frontend", "key", "PAYLOAD", "Client id Minted", "Date.now().toString()",
     "Stored as id; unique per user with a compound index.", {"step": "03"}),
    TOKEN_CARD + ({"step": "04"},),
])
c = stack(d, r3, [
    LIMITER_CARD + ({"step": "05", "tag": "E1"},),
    VERIFY_CARD + ({"step": "05", "tag": "E2"},),
    ("auth", "file-text", "MIDDLEWARE", "Joi Validation", "expenseValidation",
     "Five required fields; unknown(true) lets extras through.",
     {"step": "06", "tag": "E3"}),
    ("backend", "gears", "CONTROLLER", "Request Handler", "addExpense()",
     "One try/catch around every step below.", {"step": "06", "tag": "E4"}),
])
e = stack(d, r4, [
    USER_CARD + ({"step": "06"},),
    ("insights", "bolt", "ML CALL", "Description Fill", "generate-description",
     "Only when empty. 5 s timeout, then falls back to an empty string.",
     {"step": "07", "tag": "E5"}),
    ("database", "save", "MONGODB", "Expense Insert", "new ExpenseModel().save()",
     "userId comes from the token; a body userId is ignored.", {"step": "08"}),
    ("database", "chart", "MONGODB", "Feedback Row", "MlFeedbackModel",
     "Written only when a prediction and a confidence both exist.",
     {"step": "08"}),
])
grp = d.pill_group(r4.card_x, e[-1].bottom + 6, CW, "then, in order",
                   [("synchronizeAfterMutation", "fenced derived sync"),
                    ("clearUserExpenseCache", "4 key families"),
                    ("derivedData", "recovery outcome")])
e5 = d.card(r4.card_x, grp.bottom + 14, "response", "send", "RESPONSE",
            "201 Created", "message + success",
            "No document is returned — the client refetches instead.",
            step="10")
d.path([(e[-1].cx, e[-1].bottom), (e[-1].cx, grp.y)], "database")
d.path([(grp.cx, grp.bottom), (grp.cx, e5.y)], "database")
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)

f0, g, h = region5(
    d, e5,
    ("frontend", "refresh", "MUTATION CALLBACK", "onSuccess Invalidation",
     "4 x invalidateQueries", "Prefix keys, so every nested list and detail is marked "
     "stale at once.", {"step": "11"}),
    "Query families marked stale", [
        ("frontend", "list", "QUERY KEY", "expenses.all", "['expenses']",
         "Covers every list variant and the edit-detail entry.", {}),
        ("frontend", "gauge", "QUERY KEY", "budgets.all", "['budgets']",
         "Redraws the budget bar and the header figure.", {}),
        ("frontend", "chart", "QUERY KEY", "charts + reports", "two more prefixes",
         "Every chart page and the insight panels refetch.", {}),
    ],
    "Rendered result", [
        ("ui", "window", "NAVIGATION", "Back to the List", "navigate('/')",
         "Runs before the refetch resolves, so the list flashes.", {}),
        ("ui", "monitor", "FEEDBACK", "Success Toast", "expenseAddSuccessToast",
         "Uses the message from the response body.", {}),
        ("ui", "layout", "FORM", "Fields Cleared", "setName('') and friends",
         "ML telemetry is cleared too, so it cannot be inherited.", {}),
    ],
    ("Not invalidated", [
        "The income query family is never touched by an expense write. It holds no expense "
        "data, so nothing goes stale.",
        "Redis is cleared server-side in the same request, so a refetch cannot hit an old "
        "cached read.",
    ], "database"))

x = band(d, [
    BAND_429, BAND_401,
    ("E3", "400 Validation Failure", "expenseValidation",
     "Zero, negative, non-numeric or unsafe amounts; an empty name or category; a "
     "missing id. Verified by running the schema."),
    ("E4", "500 Persistence Failure", "addExpense catch",
     "A duplicate id, a cast failure or a Redis outage all collapse into the same "
     "generic 500 with no detail."),
    ("E5", "Description Silently Empty", "ML call catch",
     "A timed-out or failed generate-description call stores an empty description. "
     "The user is never told."),
    ("E6", "Category Case Rewritten", "normalizeCategory()",
     "The word-boundary regex capitalises after an apostrophe, so don't care is saved "
     "as Don'T Care."),
])
refs(d, [(pt, rail, gi, x[i], enter) for i, (pt, rail, gi, enter) in enumerate([
    ((c[0].right, c[0].cy), 852, 0, "left"),
    ((c[1].x, c[1].cy), 604, 1, "top-offset"),
    ((c[2].cx, c[2].bottom), c[2].cx, 2, "top"),
    ((e5.right, e5.cy), 1132, 3, "top"),
    ((e[1].right, e[1].cy), 1146, 4, "top"),
    ((a[-1].cx, a[-1].bottom), a[-1].cx, 5, "top"),
])])
finish(d, "api-05-create-expense-detailed.svg", "API-05",
       "Creation is one request. The ML description call lives inside it, is bounded by a "
       "5 s timeout, and can never prevent the insert.")


# ===========================================================================
# API-06 — PUT /expense/update-expense
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "PUT /expense/update-expense — detailed implementation workflow",
    "Level 2 · real functions, middleware and models · badges map to the 11 stages in "
    "api-06-update-expense-overview.svg",
    REGIONS_WRITE("Security & Ownership", "No validation middleware here",
                  "Whitelisted Update", "Partial $set, conditional recalc"))

a = stack(d, r1, [
    ("ui", "layout", "COMPONENT", "Form in Edit Mode", "AddExpense.js",
     "isEdit carries the target id in from the expense list.", {"step": "01"}),
    ("ui", "database", "HYDRATION", "Fields Loaded", "see FLOW-02",
     "Loaded by the retrieval-assisted edit flow, not by this route.",
     {"step": "01"}),
    ("ui", "sigma", "NORMALISE", "Text Cleanup", "sanitizeText()",
     "Identical helpers to the create path.", {"step": "02"}),
    ("ui", "list", "PAYLOAD", "Whole Form Sent", "5 fields, no diff",
     "Unchanged fields are resent with their current values.", {"step": "02"}),
])
b = stack(d, r2, [
    ("frontend", "refresh", "TANSTACK", "Update Mutation", "useUpdateExpenseMutation()",
     "Takes { editID, payload }; retry stays at 0.", {"step": "03"}),
    ("frontend", "key", "API CLIENT", "Query Parameter", "params: { editID }",
     "The id travels in the URL, the fields in the body.", {"step": "04"}),
    TOKEN_CARD + ({"step": "04"},),
    ("frontend", "gears", "CALLBACKS", "Per-call Handlers", "onSuccess / onError",
     "Shared with create; 401, 429 and 409 are handled once by the interceptor.",
     {"step": "04"}),
])
c = stack(d, r3, [
    LIMITER_CARD + ({"step": "05", "tag": "E1"},),
    VERIFY_CARD + ({"step": "05", "tag": "E2"},),
    ("error", "alert", "MIDDLEWARE", "No Joi on PUT", "route declares none",
     "Nothing validates the body on this route at all.",
     {"step": "06", "tag": "E3"}),
    ("auth", "file-text", "GUARD", "ObjectId Check", "Types.ObjectId.isValid",
     "A malformed editID answers 400 before any query runs.",
     {"step": "06", "tag": "E4"}),
])
e = stack(d, r4, [
    USER_CARD + ({"step": "06"},),
    ("database", "user-check", "MONGODB", "Ownership Read", "findOne({_id, userId})",
     "404 when the id is not this user's row.", {"step": "07"}),
    ("backend", "list", "WHITELIST", "Editable Fields", "EDITABLE_FIELDS x 5",
     "id, userId, isRecurring and ML telemetry cannot be reached.",
     {"step": "08", "tag": "E5"}),
    ("database", "save", "MONGODB", "Scoped $set", "findOneAndUpdate",
     "runValidators is not set, so no schema rule is enforced.",
     {"step": "08", "tag": "E6"}),
])
grp = d.pill_group(r4.card_x, e[-1].bottom + 6, CW, "then, conditionally",
                   [("synchronizeAfterMutation", "fenced derived sync"),
                    ("second month", "when the date moved"),
                    ("clearUserExpenseCache", "always")])
e5 = d.card(r4.card_x, grp.bottom + 14, "response", "send", "RESPONSE",
            "200 OK", "message + document",
            "The updated document is returned, then discarded by the client.",
            step="10")
d.path([(e[-1].cx, e[-1].bottom), (e[-1].cx, grp.y)], "database")
d.path([(grp.cx, grp.bottom), (grp.cx, e5.y)], "database")
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)

f0, g, h = region5(
    d, e5,
    ("frontend", "refresh", "MUTATION CALLBACK", "onSuccess Invalidation",
     "4 x invalidateQueries", "Byte-for-byte the same four calls as create and delete.",
     {"step": "11"}),
    "Query families marked stale", [
        ("frontend", "list", "QUERY KEY", "expenses.all", "['expenses']",
         "Includes the detail entry the edit form itself reads.", {}),
        ("frontend", "gauge", "QUERY KEY", "budgets.all", "['budgets']",
         "Refetched even when the amount did not change.", {}),
        ("frontend", "chart", "QUERY KEY", "charts + reports", "two more prefixes",
         "Every chart page and the insight panels refetch.", {}),
    ],
    "Rendered result", [
        ("ui", "window", "NAVIGATION", "Back to the List", "navigate('/')",
         "Edit mode is cleared by the route-change effect.", {}),
        ("ui", "monitor", "FEEDBACK", "Success Toast", "expenseAddSuccessToast",
         "Same toast helper as the create path.", {}),
        ("ui", "layout", "FORM", "Fields Cleared", "shared callbacks",
         "On failure nothing is cleared, so the edits survive.", {}),
    ],
    ("Returned but unused", [
        "The response carries the updated document, but the client discards it and "
        "refetches instead.",
        "Recalculation is skipped when only the name, category or description changed.",
    ], "database"))

x = band(d, [
    BAND_429, BAND_401,
    ("E3", "No Body Validation", "route middleware",
     "An empty name, a whitespace-only name, a negative amount or a null amount are all "
     "accepted and written. Verified against the schema."),
    ("E4", "400 vs 404 on an Id", "isValid guard",
     "A malformed id answers 400; a well-formed id belonging to nobody, or to another "
     "user, answers 404."),
    ("E5", "Immutable Fields Dropped", "EDITABLE_FIELDS",
     "Anything outside the five-name allow-list is silently ignored — no error, no hint "
     "that it was rejected."),
    ("E6", "500 on a Cast Failure", "Mongoose cast",
     "A non-numeric amount or an unparseable date raises a CastError, which the generic "
     "catch reports as 500 rather than 400."),
])
refs(d, [(pt, rail, gi, x[i], enter) for i, (pt, rail, gi, enter) in enumerate([
    ((c[0].right, c[0].cy), 852, 0, "left"),
    ((c[1].x, c[1].cy), 604, 1, "top-offset"),
    ((c[2].cx, c[2].bottom), c[2].cx, 2, "top"),
    ((c[3].right, c[3].cy), 866, 3, "top"),
    ((e[2].right, e[2].cy), 1146, 4, "top"),
    ((e5.right, e5.cy), 1132, 5, "top"),
])])
finish(d, "api-06-update-expense-detailed.svg", "API-06",
       "The update is partial and whitelisted. That whitelist is the only thing standing "
       "between the request body and the stored document.")


# ===========================================================================
# API-07 — DELETE /expense/delete-expense
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "DELETE /expense/delete-expense — detailed implementation workflow",
    "Level 2 · real functions, middleware and models · badges map to the 11 stages in "
    "api-07-delete-expense-overview.svg",
    [(20, 272, "List & Confirmation", "Card action, modal, guard", "ui"),
     (306, 272, "Mutation & Network", "TanStack mutation + axios client", "frontend"),
     (592, 272, "Security & Id Guard", "Middleware chain, in order", "auth"),
     (878, 272, "Delete & Propagation", "Hard delete, three follow-ups", "database"),
     (1164, 496, "Cache Invalidation & UI", "Server cache, query cache, screen", "insights")])

a = stack(d, r1, [
    ("ui", "list", "COMPONENT", "Expense Card", "ExpenseItem.js",
     "Desktop icon row, plus a mobile action menu.", {"step": "01"}),
    ("ui", "cursor", "HANDLER", "Id Recorded", "onDelete(expense._id)",
     "Stores the id in the page shell rather than deleting.", {"step": "01"}),
    ("ui", "alert", "MODAL", "Confirm Dialog", "DeleteAlert.js",
     "Fixed overlay; cancel simply clears the stored id.", {"step": "02"}),
    ("ui", "shield", "GUARD", "Token Presence", "localStorage token",
     "The handler returns silently when no token is stored.",
     {"step": "02", "tag": "E5"}),
])
b = stack(d, r2, [
    ("frontend", "refresh", "TANSTACK", "Delete Mutation", "useDeleteExpenseMutation()",
     "No onMutate — the row stays on screen until the refetch.", {"step": "03"}),
    ("frontend", "monitor", "OVERLAY", "Full-screen Spinner", "setIsSpinnerLoad(true)",
     "z-index 9999 covers the modal, so a second click cannot land.",
     {"step": "03"}),
    ("frontend", "send", "API CLIENT", "Body on a DELETE", "data: { id }",
     "axios needs the data key to put a body on a DELETE.", {"step": "04"}),
    TOKEN_CARD + ({"step": "04"},),
])
c = stack(d, r3, [
    LIMITER_CARD + ({"step": "05", "tag": "E1"},),
    VERIFY_CARD + ({"step": "05", "tag": "E2"},),
    ("error", "alert", "MIDDLEWARE", "No Joi on DELETE", "route declares none",
     "The body is read straight from req.body by the controller.",
     {"step": "06", "tag": "E3"}),
    ("auth", "file-text", "GUARD", "ObjectId Check", "Types.ObjectId.isValid",
     "A malformed id answers 400 before any query runs.",
     {"step": "06", "tag": "E4"}),
])
e = stack(d, r4, [
    USER_CARD + ({"step": "06"},),
    ("database", "user-check", "MONGODB", "Scoped Delete", "findOneAndDelete",
     "Owner is part of the filter, so another user's id just misses.",
     {"step": "07"}),
    ("backend", "sigma", "BRANCH", "Found or Not", "if (deletedExpense)",
     "A missing row and a foreign row are indistinguishable.",
     {"step": "07", "tag": "E6"}),
    ("database", "gears", "MONGODB", "Budget Recalc", "deletedExpense.expenseDate",
     "Recalculated from the removed row's own month.", {"step": "08"}),
])
grp = d.pill_group(r4.card_x, e[-1].bottom + 6, CW, "then, in order",
                   [("clearUserExpenseCache", "4 key families"),
                    ("derivedData", "recovery outcome"),
                    ("no other cleanup", "see the note")])
e5 = d.card(r4.card_x, grp.bottom + 14, "response", "send", "RESPONSE",
            "200 OK or 404", "message only",
            "404 carries success: false and no further detail.",
            step="10")
d.path([(e[-1].cx, e[-1].bottom), (e[-1].cx, grp.y)], "database")
d.path([(grp.cx, grp.bottom), (grp.cx, e5.y)], "database")
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)

f0, g, h = region5(
    d, e5,
    ("frontend", "refresh", "MUTATION CALLBACK", "onSuccess Invalidation",
     "4 x invalidateQueries", "The same four prefixes as create and update.",
     {"step": "11"}),
    "Query families marked stale", [
        ("frontend", "list", "QUERY KEY", "expenses.all", "['expenses']",
         "The deleted row disappears on the refetch, not before.", {}),
        ("frontend", "gauge", "QUERY KEY", "budgets.all", "['budgets']",
         "Budget bar redraws from the recalculated total.", {}),
        ("frontend", "chart", "QUERY KEY", "charts + reports", "two more prefixes",
         "Every chart page and the insight panels refetch.", {}),
    ],
    "Rendered result", [
        ("ui", "monitor", "FEEDBACK", "Delete Toast", "deleteSuccessToast",
         "Fires from the per-call onSuccess handler.", {}),
        ("ui", "window", "MODAL", "Dialog Closes", "setConfirmDeleteId(null)",
         "On failure it stays open, so a retry is one click away.", {}),
        ("ui", "layout", "LIST", "Row Removed", "AnimatePresence exit",
         "Animated out once the refetched list arrives.", {}),
    ],
    ("Left behind", [
        "A recurring schedule row keeps pointing at the deleted expense; nothing removes "
        "it, and no notification is cleaned up.",
        "There is no soft-delete flag and no archive — the document is gone.",
    ], "error"))

x = band(d, [
    BAND_429, BAND_401,
    ("E3", "No Body Validation", "route middleware",
     "The route declares no validation middleware; the id is read straight from the "
     "body and checked only for shape."),
    ("E4", "400 Invalid Expense Id", "isValid guard",
     "A malformed ObjectId is rejected before the database is touched."),
    ("E5", "Silent No-op", "confirmDeleteHandler",
     "With no token stored the handler returns without a request, without a toast and "
     "without closing the dialog."),
    ("E6", "404 Expense Not Found", "findOneAndDelete -> null",
     "Returned for an already-deleted row and for another user's row alike, so the two "
     "cannot be told apart."),
])
refs(d, [(pt, rail, gi, x[i], enter) for i, (pt, rail, gi, enter) in enumerate([
    ((c[0].right, c[0].cy), 852, 0, "left"),
    ((c[1].x, c[1].cy), 604, 1, "top-offset"),
    ((c[2].cx, c[2].bottom), c[2].cx, 2, "top"),
    ((c[3].right, c[3].cy), 866, 3, "top"),
    ((a[-1].cx, a[-1].bottom), a[-1].cx, 4, "top"),
    ((e[2].right, e[2].cy), 1146, 5, "top"),
])])
finish(d, "api-07-delete-expense-detailed.svg", "API-07",
       "Ownership is enforced inside the delete filter itself, which is why a foreign id "
       "and a missing id produce exactly the same 404.")


# ===========================================================================
# API-08 — PATCH /api/recurring
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "PATCH /api/recurring — detailed implementation workflow",
    "Level 2 · real functions, middleware and models · badges map to the 11 stages in "
    "api-08-toggle-recurring-overview.svg",
    [(20, 272, "Expense Card Action", "Toggle, derived state, toast", "ui"),
     (306, 272, "Optimistic Cache Patch", "The only onMutate in the app", "frontend"),
     (592, 272, "Security & Body Guard", "Middleware chain, in order", "auth"),
     (878, 272, "Schedule Record & Flag", "Two collections, no transaction", "database"),
     (1164, 496, "Response & Client State", "What is, and is not, reconciled", "insights")])

a = stack(d, r1, [
    ("ui", "list", "COMPONENT", "Expense Card", "ExpenseItem.js",
     "One icon that flips between mark and unmark.", {"step": "01"}),
    ("ui", "sigma", "HANDLER", "State Derived", "!expense.isRecurring",
     "Read from whatever the query cache currently holds.",
     {"step": "01", "tag": "E5"}),
    ("ui", "cursor", "GUARD", "No Confirmation", "none declared",
     "The toggle fires on the first click, with no dialog.", {"step": "02"}),
    ("ui", "monitor", "FEEDBACK", "Result Toast", "signUpSuccessToast",
     "Reuses the auth toast helpers for both outcomes.", {"step": "02"}),
])
b = stack(d, r2, [
    ("frontend", "refresh", "TANSTACK", "Toggle Mutation", "useUpdateRecurringMutation()",
     "The only mutation in the application with an onMutate.", {"step": "02"}),
    ("frontend", "shield", "ONMUTATE", "Queries Cancelled", "cancelQueries + snapshot",
     "Every ['expenses'] query is stopped, then snapshotted.", {"step": "02"}),
    ("frontend", "layers", "PATCH", "Cache Rewritten", "patchRecurringInCache",
     "Handles arrays, single documents and category maps alike.",
     {"step": "02", "tag": "E6"}),
    TOKEN_CARD + ({"step": "04"},),
])
c = stack(d, r3, [
    LIMITER_CARD + ({"step": "05", "tag": "E1"},),
    VERIFY_CARD + ({"step": "05", "tag": "E2"},),
    ("auth", "file-text", "GUARD", "Body Type Check", "typeof isRecurring",
     "400 unless the flag is a real boolean and an id is present.",
     {"step": "06", "tag": "E3"}),
    ("error", "alert", "CONTROLLER", "No ObjectId Guard", "recurring()",
     "Unlike update and delete, a malformed id reaches Mongoose.",
     {"step": "06", "tag": "E4"}),
])
e = stack(d, r4, [
    ("database", "user-check", "MONGODB", "Ownership Read", "findOne({_id, userId})",
     "A missing expense answers 403, not 404.", {"step": "07"}),
    ("database", "save", "MONGODB", "Schedule Row", "RecurringExpenseModel",
     "Created when marking, deleted when unmarking.", {"step": "08"}),
    ("backend", "key", "SCHEDULE", "Next Due Date", "Date.UTC(y, m + 1, 1)",
     "First of next month, always computed in UTC.", {"step": "08"}),
    ("database", "gears", "MONGODB", "Flag Written", "expense.save()",
     "A second, separate write; the pair is not transactional.",
     {"step": "09", "tag": "E6"}),
])
nb = d.note_box(r4.card_x, e[-1].bottom + 12, CW, 150, "No cache work on this route", [
    "This controller never calls clearUserExpenseCache, so cached reads keep the old "
    "flag for 300 s.",
    "It also never calls refreshReport.",
], "error")
e5 = d.card(r4.card_x, nb.bottom + 12, "response", "send", "RESPONSE",
            "201 or 200 OK", "message only",
            "201 when marking, 200 when clearing; no document returned.",
            step="10")
d.path([(e[-1].cx, e[-1].bottom), (e[-1].cx, nb.y)], "error")
d.path([(nb.cx, nb.bottom), (nb.cx, e5.y)], "database")
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)

f0, g, h = region5(
    d, e5,
    ("ui", "monitor", "CLIENT STATE", "Optimistic Value Retained", "no invalidateQueries",
     "Nothing refetches, so the patched value is never compared with the server.",
     {"step": "11"}),
    "What does happen", [
        ("frontend", "layers", "CACHE", "Patch Stays", "setQueriesData result",
         "The icon reflects the request, not a confirmed write.", {}),
        ("frontend", "refresh", "ONERROR", "Snapshot Restored", "previousQueries",
         "Every patched key is rolled back on a failure.", {}),
        ("ui", "monitor", "FEEDBACK", "Toast Shown", "signUpSuccessToast",
         "The only signal that the server agreed.", {}),
    ],
    "What reveals the truth", [
        ("ui", "window", "REFRESH", "A Full Reload", "queryClient rebuilt",
         "The server value reappears on the next cold load.", {}),
        ("ui", "refresh", "ANOTHER WRITE", "Create or Delete", "their invalidation",
         "An unrelated expense write refetches the list for free.", {}),
        ("ui", "gauge", "EXPIRY", "Stale Time Lapses", "5 min gc / stale",
         "A remount after the window refetches on its own.", {}),
    ],
    ("Not performed here", [
        "No invalidateQueries, no refetch and no Redis clear follow a successful toggle.",
        "The two writes are also independent: a schedule row can exist while the flag "
        "write fails.",
    ], "error"))

x = band(d, [
    BAND_429, BAND_401,
    ("E3", "400 Invalid Request", "inline body guard",
     "A missing expenseId, or an isRecurring that is a string rather than a boolean, "
     "is rejected before any query."),
    ("E4", "500 on a Malformed Id", "no isValid guard",
     "This route has no ObjectId check, so a malformed id becomes a CastError and "
     "surfaces as a generic 500."),
    ("E5", "403 for a Missing Row", "findOne -> null",
     "A deleted or foreign expense answers 403 Unauthorized rather than 404, so the "
     "two cases cannot be told apart."),
    ("E6", "Stale Reads for 300 s", "no cache invalidation",
     "Cached expense reads keep the old flag, and no query is invalidated, so the "
     "optimistic patch is never reconciled."),
])
refs(d, [(pt, rail, gi, x[i], enter) for i, (pt, rail, gi, enter) in enumerate([
    ((c[0].right, c[0].cy), 852, 0, "left"),
    ((c[1].x, c[1].cy), 604, 1, "top-offset"),
    ((c[2].cx, c[2].bottom), c[2].cx, 2, "top"),
    ((c[3].right, c[3].cy), 866, 3, "top"),
    ((a[1].cx, a[1].bottom), a[1].cx, 4, "top"),
    ((nb.right, nb.cy), 1132, 5, "top"),
])])
finish(d, "api-08-toggle-recurring-detailed.svg", "API-08",
       "This is the only optimistic mutation in the application, and the only expense "
       "write that clears no server cache and invalidates no query.")


# ===========================================================================
# FLOW-01 — ML-assisted expense entry
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "ML-assisted expense entry — detailed combined workflow",
    "Level 2 · prediction and persistence are separate requests · badges map to the "
    "10 stages in flow-01-ml-assisted-entry-overview.svg",
    [(20, 272, "Typing & Debounce", "What starts a prediction", "ui"),
     (306, 272, "Prediction Dependency", "External to the expense module", "insights"),
     (592, 272, "Review & Override", "Frontend only — no request", "ui"),
     (878, 272, "Persistence Request", "The separate, explicit save", "database"),
     (1164, 496, "Feedback & UI", "What the save records", "frontend")])

a = stack(d, r1, [
    ("ui", "cursor", "INPUT", "Name Field", "onChange -> setName",
     "Every keystroke re-runs the prediction effect.", {"step": "01"}),
    ("ui", "file-text", "GUARD", "Length Check", "trim().length < 3",
     "Names shorter than three characters never fire a request.", {"step": "01"}),
    ("ui", "shield", "GUARD", "Programmatic Skip", "programmaticNameRef",
     "A bill prefill or an edit load is skipped exactly once.",
     {"step": "02", "tag": "E5"}),
    ("ui", "gauge", "TIMER", "Debounce Window", "setTimeout 500 ms",
     "Cleared and restarted by the effect cleanup on each key.", {"step": "02"}),
])
b = stack(d, r2, [
    ("insights", "refresh", "RESET", "Category Cleared", "setCategory('')",
     "A category typed before the name is wiped here.",
     {"step": "03", "tag": "E6"}),
    ("insights", "shield", "ABORT", "Supersede Guard", "AbortController",
     "The cleanup aborts the in-flight request, so no stale answer lands.",
     {"step": "03"}),
    ("frontend", "send", "FETCH", "Prediction Request", "window.fetch",
     "Not the shared axios client; the token is read directly.", {"step": "04"}),
    ("auth", "bolt", "EXTERNAL", "Backend Proxy", "POST /ml/predict-category",
     "Forwarded to the ML service with a 5 s timeout.", {"step": "04"}),
])
nb2 = d.note_box(r2.card_x, b[-1].bottom + 12, CW, 150, "ML module boundary", [
    "The model, its training data and confidence calibration belong to the ML service, "
    "not here.",
    "This is drawn as an external dependency, not an expense API.",
], "insights")
d.path([(b[-1].cx, b[-1].bottom), (b[-1].cx, nb2.y)], "insights")

c = stack(d, r3, [
    ("insights", "chart", "RESPONSE", "Prediction Applied", "setCategory + confidence",
     "Applied only when predictedCategory is present in the body.", {"step": "05"}),
    ("ui", "monitor", "DISPLAY", "Confidence Label", "ML Confidence Score",
     "Shown beside the field label; purely informational.", {"step": "05"}),
    ("ui", "cursor", "EDITABLE", "Free-text Field", "maxLength 20",
     "Not a select — any category string at all is accepted.", {"step": "06"}),
    ("ui", "key", "OVERRIDE", "User Types", "setCategory",
     "Editing the category never re-triggers a prediction.", {"step": "07"}),
])
e = stack(d, r4, [
    ("database", "send", "SUBMIT", "Explicit Save", "handleSubmit -> API-05",
     "Nothing has been written until this click.", {"step": "08"}),
    ("frontend", "layers", "PAYLOAD", "Telemetry Attached", "mlPredictedCategory + score",
     "A client wasMlCorrected flag is sent, but not trusted.",
     {"step": "08", "tag": "E3"}),
    ("backend", "sigma", "SERVER", "Correction Derived", "deriveMlCorrection()",
     "Recomputed from predicted versus saved category.", {"step": "09"}),
    ("database", "save", "MONGODB", "Two Documents", "Expense + MlFeedback",
     "Feedback is written only when a prediction and a score exist.",
     {"step": "09"}),
])
grp = d.pill_group(r4.card_x, e[-1].bottom + 6, CW, "feedback status",
                   [("corrected", "status: pending"),
                    ("accepted", "status: null"),
                    ("no prediction", "no row at all")])
e5 = d.card(r4.card_x, grp.bottom + 14, "response", "send", "RESPONSE",
            "201 Created", "message + success",
            "One response covers both documents.", step="10")
d.path([(e[-1].cx, e[-1].bottom), (e[-1].cx, grp.y)], "database")
d.path([(grp.cx, grp.bottom), (grp.cx, e5.y)], "database")
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)

f0, g, h = region5(
    d, e5,
    ("frontend", "refresh", "AFTER THE SAVE", "Telemetry Cleared", "onSuccess only",
     "Prediction and confidence are reset so the next expense cannot inherit them.",
     {"step": "10"}),
    "Stored on the expense", [
        ("database", "save", "FIELD", "mlPredictedCategory", "String, default ''",
         "Whatever the client sent, stored without a range check.", {}),
        ("database", "gauge", "FIELD", "mlConfidence", "Number, default 0",
         "No bounds are enforced on the value.", {}),
        ("database", "sigma", "FIELD", "wasMlCorrected", "Boolean, default false",
         "The raw client flag; the server keeps its own derivation.", {}),
    ],
    "Prediction is advisory", [
        ("ui", "cursor", "OVERRIDE", "Always Editable", "no disabled state",
         "The field is never locked, whatever the confidence.", {}),
        ("ui", "shield", "FAILURE", "Never Blocking", "silent catch",
         "A 503 or timeout leaves the field empty and typeable.", {}),
        ("ui", "gauge", "THRESHOLD", "No Cut-off", "score unused",
         "A 12% and a 99% prediction are applied identically.", {}),
    ],
    ("Where the boundary sits", [
        "Prediction writes into a form field and nothing else. No expense and no feedback "
        "row exists until the user submits.",
        "Retrying a prediction is therefore always safe.",
    ], "error"))

x = band(d, [
    BAND_429, BAND_401,
    ("E3", "Client Telemetry Trusted", "ExpenseModel fields",
     "mlPredictedCategory, mlConfidence and wasMlCorrected are stored as sent. Only the "
     "feedback row's own verdict is re-derived."),
    ("E4", "503 Prediction Unavailable", "ml.router catch",
     "A timeout or an unreachable service answers 503. The form ignores it silently, "
     "so the user sees only an empty category."),
    ("E5", "Telemetry Can Outlive Its Name", "no reset on prefill",
     "A prediction is cleared only on a successful save, so a later bill prefill or edit "
     "load can submit it against a different name."),
    ("E6", "Manual Category Overwritten", "setCategory('')",
     "Choosing a category and then editing the name clears the choice, because the "
     "debounced effect resets the field before it asks."),
])
refs(d, [(pt, rail, gi, x[i], enter) for i, (pt, rail, gi, enter) in enumerate([
    ((c[0].right, c[0].cy), 852, 0, "left"),
    ((c[1].x, c[1].cy), 604, 1, "top-offset"),
    ((e[1].right, e[1].cy), 1146, 2, "top"),
    ((nb2.cx, nb2.bottom), nb2.cx, 3, "top"),
    ((a[2].cx, a[2].bottom), a[2].cx, 4, "top"),
    ((b[0].right, b[0].cy), 580, 5, "top"),
])])
finish(d, "flow-01-ml-assisted-entry-detailed.svg", "FLOW-01",
       "Two independent requests, no transaction between them. Prediction is advisory and "
       "persists nothing; only the explicit save writes.")


# ===========================================================================
# FLOW-02 — retrieval-assisted expense edit
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "Retrieval-assisted expense edit — detailed combined workflow",
    "Level 2 · one read hydrates the form, one write saves it · badges map to the "
    "10 stages in flow-02-retrieval-assisted-edit-overview.svg",
    [(20, 272, "Edit Entry", "From the list into the form", "ui"),
     (306, 272, "Retrieval Dependency", "Upstream read, not a new API", "backend"),
     (592, 272, "Form Hydration", "Frontend only — no request", "ui"),
     (878, 272, "Update Request", "The separate, explicit save", "database"),
     (1164, 496, "Cache & UI", "What refreshes, and when", "insights")])

a = stack(d, r1, [
    ("ui", "list", "COMPONENT", "Expense Card", "ExpenseItem.js",
     "The edit icon and the mobile menu share one handler.", {"step": "01"}),
    ("ui", "key", "HANDLER", "Id Stored", "setIsEdit({ expense_id })",
     "Held in the page shell, then the router navigates.", {"step": "01"}),
    ("ui", "window", "COMPONENT", "Edit Mode Opens", "AddExpense.js",
     "The same form, with a full-screen spinner while loading.", {"step": "02"}),
    ("ui", "refresh", "LIFECYCLE", "Reset on Leave", "route-change effect",
     "Leaving /add clears edit mode, so a stale id cannot linger.",
     {"step": "02"}),
])
b = stack(d, r2, [
    ("frontend", "database", "TANSTACK", "Cached Detail Read", "queryClient.fetchQuery",
     "Served from cache inside the 5 minute stale window.",
     {"step": "03", "tag": "E5"}),
    ("frontend", "key", "QUERY KEY", "Detail Entry", "expenses.detail(id)",
     "Nested under ['expenses'], so every write invalidates it.", {"step": "03"}),
    ("auth", "shield", "MIDDLEWARE", "Limiter then JWT", "apiLimiter -> verifyToken",
     "The same pair as every other expense route.",
     {"step": "04", "tag": "E1"}),
    ("backend", "user-check", "RETRIEVAL", "Scoped Read", "GET expense-edit-data",
     "findOne on id and userId; 400 on a malformed id, 404 on a miss.",
     {"step": "04", "tag": "E2"}),
])
nb2 = d.note_box(r2.card_x, b[-1].bottom + 12, CW, 150, "Why this is not a new API", [
    "A retrieval endpoint, shown as an upstream dependency of the edit workflow, not "
    "as a mutation.",
    "It is the one expense read outside the approved viewing set.",
], "backend")
d.path([(b[-1].cx, b[-1].bottom), (b[-1].cx, nb2.y)], "backend")

c = stack(d, r3, [
    ("ui", "layout", "HYDRATION", "Five Fields Set", "setName, setCategory...",
     "Every editable field is filled from the response.", {"step": "05"}),
    ("ui", "gauge", "TRANSFORM", "Date Trimmed", "expenseDate.split('T')[0]",
     "Cut to a day part for the native date input.", {"step": "05"}),
    ("insights", "shield", "GUARD", "Prediction Held", "programmaticNameRef",
     "The loaded category survives; no prediction runs.",
     {"step": "06", "tag": "E6"}),
    ("ui", "cursor", "EDIT", "User Changes Fields", "any field",
     "Typing in the name releases the hold and prediction resumes.",
     {"step": "07"}),
])
e = stack(d, r4, [
    ("database", "send", "SUBMIT", "Explicit Save", "handleSubmit -> API-06",
     "The whole form is sent, never a diff.", {"step": "08"}),
    ("auth", "file-text", "GUARD", "ObjectId Check", "Types.ObjectId.isValid",
     "The same guard the read used, repeated on the write.", {"step": "08"}),
    ("database", "user-check", "MONGODB", "Ownership Read", "findOne({_id, userId})",
     "404 when the row was deleted between load and save.",
     {"step": "09", "tag": "E4"}),
    ("database", "save", "MONGODB", "Whitelisted $set", "5 editable fields",
     "Anything outside the allow-list is silently dropped.", {"step": "09"}),
])
grp = d.pill_group(r4.card_x, e[-1].bottom + 6, CW, "then, conditionally",
                   [("synchronizeAfterMutation", "fenced derived sync"),
                    ("second month", "when the date moved"),
                    ("clearUserExpenseCache", "always")])
e5 = d.card(r4.card_x, grp.bottom + 14, "response", "send", "RESPONSE",
            "200 OK", "message + document",
            "The updated document is returned but not cached.",
            step="09")
d.path([(e[-1].cx, e[-1].bottom), (e[-1].cx, grp.y)], "database")
d.path([(grp.cx, grp.bottom), (grp.cx, e5.y)], "database")
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)

f0, g, h = region5(
    d, e5,
    ("frontend", "refresh", "MUTATION CALLBACK", "onSuccess Invalidation",
     "4 x invalidateQueries", "The detail entry that hydrated this form is invalidated "
     "along with the lists.", {"step": "10"}),
    "Query families marked stale", [
        ("frontend", "database", "QUERY KEY", "expenses.detail", "nested under expenses",
         "So the next edit-open reloads rather than reusing.", {}),
        ("frontend", "list", "QUERY KEY", "expenses.lists", "every filter variant",
         "Last week, by category and custom range alike.", {}),
        ("frontend", "chart", "QUERY KEY", "budgets, charts, reports", "three prefixes",
         "Refetched whether or not the amount changed.", {}),
    ],
    "Rendered result", [
        ("ui", "window", "NAVIGATION", "Back to the List", "navigate('/')",
         "Edit mode clears on the route change.", {}),
        ("ui", "monitor", "FEEDBACK", "Success Toast", "expenseAddSuccessToast",
         "Shared with the create path.", {}),
        ("ui", "alert", "ON FAILURE", "Edits Survive", "no reset on error",
         "The form keeps its values so the user can retry.", {}),
    ],
    ("Two requests, no transaction", [
        "The read and the write are independent. A row deleted in between fails the "
        "save with 404.",
        "Retrying the save is safe; it is idempotent for the same payload.",
    ], "error"))

x = band(d, [
    ("E1", "429 Too Many Requests", "apiLimiter",
     "Applies to the hydration read and to the save alike, keyed by IP."),
    ("E2", "400 or 404 on Hydration", "geteditexpense",
     "A malformed id answers 400; an id that is not this user's answers 404 and the "
     "form stays empty behind the spinner."),
    ("E3", "Errors Reach the Console Only", "fetchEditExpense catch",
     "A failed hydration logs and clears the spinner. No toast is shown, so the user "
     "sees an empty form with no explanation."),
    ("E4", "404 Between Load and Save", "findOne -> null",
     "If the expense is deleted after hydration, the save fails with 404 while the "
     "edited values remain on screen."),
    ("E5", "Stale Hydration Window", "5 min staleTime",
     "Inside the stale window the form can load a cached copy of a row that has since "
     "changed in another tab."),
    ("E6", "Loaded Category Protected", "programmaticNameRef",
     "Deliberate, and correct here — but the same ref is what lets stale prediction "
     "telemetry survive into a later save."),
])
refs(d, [(pt, rail, gi, x[i], enter) for i, (pt, rail, gi, enter) in enumerate([
    ((b[2].right, b[2].cy), 580, 0, "left"),
    ((b[3].x, b[3].cy), 604, 1, "top-offset"),
    ((nb2.cx, nb2.bottom), nb2.cx, 2, "top"),
    ((e[2].right, e[2].cy), 1146, 3, "top"),
    ((b[0].right, b[0].cy), 566, 4, "top"),
    ((c[2].cx, c[2].bottom), c[2].cx, 5, "top"),
])])
finish(d, "flow-02-retrieval-assisted-edit-detailed.svg", "FLOW-02",
       "The hydration read is an upstream dependency, cross-linked rather than counted; "
       "the write is API-06, reused unchanged.")
