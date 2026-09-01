"""
Level 1 overviews for the Expense mutation set — one file, six outputs.

Four mutation endpoints (API-05 … API-08) and two combined flows. Every shape here was
already approved in the expense-viewing, budget, income, charts and bills sets; nothing
new was added to the design system.

Two layouts are used:

  write-shape   row 1  01 02 03 04 05 06        10 11
                row 2                    07 08 09
  read-shape    row 1  01 02 03 04 05 06 07 08 09
                row 2                             10

Run:  python3 build_expense_mutations_overviews.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))   # shared engine lives one level up

from workflow_diagram import Overview, load_tokens   # noqa: E402


def new(title, subtitle):
    return Overview(load_tokens(), title=title, subtitle=subtitle)


def error_card(o, x, y, w, title, lines):
    d, ep = o.d, o.d.pal("error")
    body = "".join(d._text(x + 13, y + 44 + i * 13, ln, 9.8, d.n["inkMuted"], 400)
                   for i, ln in enumerate(lines))
    d.mid.append('<g><rect x="%d" y="%d" width="%d" height="%d" rx="10" fill="%s" '
                 'stroke="%s" stroke-width="1" stroke-dasharray="4 3"/>%s%s%s</g>'
                 % (x, y, w, 34 + len(lines) * 13 + 12, ep["fill"], ep["border"],
                    d._icon("alert", x + 13, y + 12, ep["line"], 0.78),
                    d._text(x + 34, y + 25, title, 10.8, ep["ink"], 700), body))


def save(o, svg, name):
    folders = {"api-05": "create", "api-06": "update", "api-07": "delete", "api-08": "toggle-recurring", "flow-01": "flow", "flow-02": "flow"}
    folder = next(value for key, value in folders.items() if name.startswith(key))
    open(os.path.join(HERE, folder, name), "w", encoding="utf-8").write(svg)
    print("wrote", name, len(svg))


def write_shape(o, row1_a, row2, row1_b, drop_label, rise_label):
    """01-06 across row 1, 07-09 in row 2, 10-11 back up in row 1."""
    d = o.d
    o.chain(row1_a, o.R1_CY)
    o.chain(row2, o.R2_CY)
    d.path([(row1_a[-1].cx, row1_a[-1].bottom), (row1_a[-1].cx, row2[0].y)],
           "backend", width=2.8, label=drop_label,
           label_at=(row1_a[-1].cx, o.LABEL_Y))
    d.path([(row2[-1].cx, row2[-1].y), (row2[-1].cx, row1_b[0].bottom)],
           "response", width=3.0, label=rise_label,
           label_at=(row2[-1].cx, o.LABEL_Y))
    d.path([(row1_b[0].right, o.R1_CY), (row1_b[1].x, o.R1_CY)], row1_b[1].kind,
           width=2.8)


def tail_error(o, last, title, lines, row_cy=None):
    cy = o.R1_CY if row_cy is None else row_cy
    error_card(o, o.COL[8], 460, o.CW, title, lines)
    o.d.path([(last.right, cy), (1584, cy), (1584, 502), (o.COL[8] + o.CW, 502)],
             "error", dashed=True)


# ===========================================================================
# API-05 — POST /expense/add-expense
# ===========================================================================
o = new("POST /expense/add-expense — creating an expense",
        "Quick overview · follow 01 → 11 · full detail in "
        "api-05-create-expense-detailed.svg")
d = o.d

d.group_box(882, 276, 704, 180, "Server-side write", "backend",
            note="one insert, then follow-ups",
            label_x=996, note_x=1180)

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "POST /expense/add-expense",             "response"),
    ("Validation", "Joi expenseValidation, then Mongoose",   "auth"),
    ("Ownership",  "userId taken from the JWT, never body", "database"),
    ("Redis",      "clearUserExpenseCache + report refresh", "insights"),
    ("Invalidates", "expenses, budgets, reports, charts",   "frontend"),
])

a = [
    o.card(0, o.ROW1, "ui", "layout", "01", "Expense Form", "AddExpense",
           "Typed, or prefilled from a bill."),
    o.card(1, o.ROW1, "ui", "cursor", "02", "Client Cleanup", "sanitizeText",
           "Trim, collapse spaces, title-case."),
    o.card(2, o.ROW1, "frontend", "refresh", "03", "Create Mutation", "TanStack Mutation",
           "retry 0 — no automatic resend."),
    o.card(3, o.ROW1, "auth", "key", "04", "Authenticated POST", "Axios + JWT",
           "Bearer token from localStorage."),
    o.card(4, o.ROW1, "auth", "shield", "05", "API Security", "Limiter + JWT",
           "IP rate limit, then JWT validation."),
    o.card(5, o.ROW1, "auth", "gauge", "06", "Joi Validation", "expenseValidation",
           "Five required fields; extras allowed."),
]
b = [
    o.card(5, o.ROW2, "insights", "bolt", "07", "Description Fill", "ML Service",
           "Only when the field is left empty."),
    o.card(6, o.ROW2, "database", "save", "08", "Document Insert", "ExpenseModel",
           "userId comes from the token."),
    o.card(7, o.ROW2, "database", "gears", "09", "Budget and Report", "Propagation",
           "Recalculate, clear Redis, refresh."),
]
c = [
    o.card(7, o.ROW1, "response", "send", "10", "201 Created", "Message Only",
           "No document is returned."),
    o.card(8, o.ROW1, "frontend", "key", "11", "Refresh and Go", "Invalidate",
           "Four query families, then navigate."),
]
write_shape(o, a, b, c, "VALIDATED", "201 CREATED")
tail_error(o, c[1], "Amount rules differ",
           ["The form allows 0 but Joi", "rejects it, so a zero-amount", "save fails as a 400."])
save(o, o.render(["Creation is a single request. The ML description call happens inside it and "
                  "falls back to an empty string; it can never block the insert."], "API-05"),
     "api-05-create-expense-overview.svg")


# ===========================================================================
# API-06 — PUT /expense/update-expense
# ===========================================================================
o = new("PUT /expense/update-expense — editing an expense",
        "Quick overview · follow 01 → 11 · full detail in "
        "api-06-update-expense-detailed.svg")
d = o.d

d.group_box(882, 276, 704, 180, "Server-side write", "backend",
            note="whitelisted fields only",
            label_x=996, note_x=1180)

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "PUT /expense/update-expense",           "response"),
    ("Target",     "?editID=<ObjectId> in the query",       "frontend"),
    ("Validation", "None — no Joi, no runValidators",       "error"),
    ("Editable",   "5 whitelisted fields, partial $set",    "backend"),
    ("Recalculate", "Only if amount or date changed",       "database"),
])

a = [
    o.card(0, o.ROW1, "ui", "layout", "01", "Form in Edit Mode", "AddExpense",
           "Same form, hydrated fields."),
    o.card(1, o.ROW1, "ui", "cursor", "02", "Client Cleanup", "sanitizeText",
           "Identical to the create path."),
    o.card(2, o.ROW1, "frontend", "refresh", "03", "Update Mutation", "TanStack Mutation",
           "Sends editID plus a payload."),
    o.card(3, o.ROW1, "auth", "key", "04", "Authenticated PUT", "Axios + JWT",
           "Target id travels as a query param."),
    o.card(4, o.ROW1, "auth", "shield", "05", "API Security", "Limiter + JWT",
           "No validation middleware on PUT."),
    o.card(5, o.ROW1, "auth", "gauge", "06", "ObjectId Guard", "isValid check",
           "Malformed ids are rejected as 400."),
]
b = [
    o.card(5, o.ROW2, "database", "user-check", "07", "Ownership Read", "Scoped findOne",
           "Matched on id and userId together."),
    o.card(6, o.ROW2, "backend", "list", "08", "Field Whitelist", "Five Fields",
           "Absent fields are left untouched."),
    o.card(7, o.ROW2, "database", "gears", "09", "Conditional Recalc", "Propagation",
           "Both months when the date moves."),
]
c = [
    o.card(7, o.ROW1, "response", "send", "10", "200 OK", "Updated Document",
           "The saved document is returned."),
    o.card(8, o.ROW1, "frontend", "key", "11", "Refresh and Go", "Invalidate",
           "Four query families, then navigate."),
]
write_shape(o, a, b, c, "ID ACCEPTED", "200 OK")
tail_error(o, c[1], "No field validation",
           ["Nothing checks the values,", "so an empty name or a", "negative amount is stored."])
save(o, o.render(["An update is partial: only the fields present in the body are written. "
                  "The whitelist means an id, ownership or ML field can never be changed."],
                 "API-06"),
     "api-06-update-expense-overview.svg")


# ===========================================================================
# API-07 — DELETE /expense/delete-expense
# ===========================================================================
o = new("DELETE /expense/delete-expense — removing an expense",
        "Quick overview · follow 01 → 11 · full detail in "
        "api-07-delete-expense-detailed.svg")
d = o.d

d.group_box(882, 276, 704, 180, "Server-side write", "backend",
            note="hard delete, nothing archived",
            label_x=996, note_x=1180)

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "DELETE /expense/delete-expense",        "response"),
    ("Target",     "id in the request body, not the URL",   "frontend"),
    ("Semantics",  "Hard delete — no soft flag, no archive", "error"),
    ("Ownership",  "findOneAndDelete on id AND userId",     "database"),
    ("Confirm",    "DeleteAlert modal before the request",  "ui"),
])

a = [
    o.card(0, o.ROW1, "ui", "list", "01", "Expense Card", "ExpenseItem",
           "Delete icon, or the mobile menu."),
    o.card(1, o.ROW1, "ui", "alert", "02", "Confirm Dialog", "DeleteAlert",
           "Two buttons; no default focus."),
    o.card(2, o.ROW1, "frontend", "refresh", "03", "Delete Mutation", "TanStack Mutation",
           "No optimistic removal is done."),
    o.card(3, o.ROW1, "auth", "key", "04", "Authenticated DELETE", "Axios + JWT",
           "Body carried in the data option."),
    o.card(4, o.ROW1, "auth", "shield", "05", "API Security", "Limiter + JWT",
           "No validation middleware on DELETE."),
    o.card(5, o.ROW1, "auth", "gauge", "06", "ObjectId Guard", "isValid check",
           "Malformed ids are rejected as 400."),
]
b = [
    o.card(5, o.ROW2, "database", "user-check", "07", "Scoped Delete", "findOneAndDelete",
           "Another user's id simply misses."),
    o.card(6, o.ROW2, "database", "gears", "08", "Budget Recalc", "Removed Month",
           "Uses the deleted document's date."),
    o.card(7, o.ROW2, "database", "layers", "09", "Cache and Report", "Propagation",
           "Redis cleared, report regenerated."),
]
c = [
    o.card(7, o.ROW1, "response", "send", "10", "200 OK or 404", "Message Only",
           "404 when nothing matched."),
    o.card(8, o.ROW1, "frontend", "key", "11", "Refresh and Toast", "Invalidate",
           "Four query families, modal closes."),
]
write_shape(o, a, b, c, "ID ACCEPTED", "200 OK")
tail_error(o, c[1], "Nothing to clean up",
           ["No file, recurring record or", "notification is removed with", "the expense."])
save(o, o.render(["Deletion is scoped by owner in the query itself, so a mismatched id is "
                  "indistinguishable from a missing one — both answer 404."], "API-07"),
     "api-07-delete-expense-overview.svg")


# ===========================================================================
# API-08 — PATCH /api/recurring
# ===========================================================================
o = new("PATCH /api/recurring — toggling an expense as recurring",
        "Quick overview · follow 01 → 11 · full detail in "
        "api-08-toggle-recurring-detailed.svg")
d = o.d

d.group_box(882, 276, 704, 180, "Server-side write", "backend",
            note="two writes, no transaction",
            label_x=996, note_x=1180)

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "PATCH /api/recurring",                  "response"),
    ("Mutates",    "Expense.isRecurring + a schedule row",  "database"),
    ("Strategy",   "Optimistic patch with rollback",        "frontend"),
    ("Redis",      "None — no cache is cleared",            "error"),
    ("Invalidates", "Nothing — the patch is never checked", "error"),
])

a = [
    o.card(0, o.ROW1, "ui", "list", "01", "Recurring Icon", "ExpenseItem",
           "Toggles the current state."),
    o.card(1, o.ROW1, "frontend", "layers", "02", "Optimistic Patch", "onMutate",
           "Every cached expense query edited."),
    o.card(2, o.ROW1, "frontend", "refresh", "03", "Toggle Mutation", "TanStack Mutation",
           "Snapshot kept for rollback."),
    o.card(3, o.ROW1, "auth", "key", "04", "Authenticated PATCH", "Axios + JWT",
           "Sends expenseId and a boolean."),
    o.card(4, o.ROW1, "auth", "shield", "05", "API Security", "Limiter + JWT",
           "Mounted on the shared /api router."),
    o.card(5, o.ROW1, "auth", "gauge", "06", "Body Type Guard", "Inline check",
           "Requires a real boolean, not a string."),
]
b = [
    o.card(5, o.ROW2, "database", "user-check", "07", "Ownership Read", "Scoped findOne",
           "A missing expense answers 403."),
    o.card(6, o.ROW2, "database", "save", "08", "Schedule Record", "Create or Delete",
           "Next due date is the 1st, in UTC."),
    o.card(7, o.ROW2, "database", "gears", "09", "Flag Saved", "expense.save()",
           "Second write; no transaction."),
]
c = [
    o.card(7, o.ROW1, "response", "send", "10", "201 or 200 OK", "Message Only",
           "201 when marking, 200 when clearing."),
    o.card(8, o.ROW1, "ui", "monitor", "11", "Patch Retained", "No Refetch",
           "The optimistic value simply stays."),
]
write_shape(o, a, b, c, "OWNED", "SUCCESS")
tail_error(o, c[1], "Server value unread",
           ["Success neither invalidates", "a query nor clears Redis, so", "nothing confirms the write."])
save(o, o.render(["This is the only optimistic mutation in the application. It is also the only "
                  "expense write that clears no server cache and invalidates no query."],
                 "API-08"),
     "api-08-toggle-recurring-overview.svg")


# ===========================================================================
# FLOW-01 — ML-assisted expense entry
# ===========================================================================
o = new("ML-assisted expense entry — prediction, review, then saving",
        "Quick overview · follow 01 → 10 · two independent requests, one explicit save")
d = o.d

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Step 1",     "POST /ml/predict-category — advisory",  "insights"),
    ("Step 2",     "POST /expense/add-expense — the save",  "database"),
    ("Trigger",    "Typing the name, 3+ characters",        "ui"),
    ("Authority",  "Advisory — always user-overridable",    "response"),
    ("Persists",   "Prediction alone stores nothing",       "error"),
])

d.note_box(882, 276, 516, 168, "Where the boundary sits", [
    "Prediction only writes into a form field. No expense, and no feedback row, exists "
    "until the user submits.",
    "The saved category is whatever is in the field at submit time, predicted or not.",
], "error")

t = [
    o.card(0, o.ROW1, "ui", "cursor", "01", "User Types Name", "AddExpense",
           "Runs only from 3 characters up."),
    o.card(1, o.ROW1, "frontend", "gauge", "02", "Debounce Window", "500 ms",
           "Earlier request aborted on each key."),
    o.card(2, o.ROW1, "frontend", "refresh", "03", "Category Cleared", "setCategory('')",
           "Cleared before the request starts."),
    o.card(3, o.ROW1, "auth", "send", "04", "Prediction Call", "Backend Proxy",
           "Plain fetch, not the axios client."),
    o.card(4, o.ROW1, "insights", "bolt", "05", "Prediction Back", "Category + Score",
           "Confidence shown beside the label."),
    o.card(5, o.ROW1, "ui", "layout", "06", "Field Prefilled", "Advisory Only",
           "Nothing is locked or disabled."),
    o.card(6, o.ROW1, "ui", "cursor", "07", "Review and Edit", "Manual Override",
           "Typed text always wins."),
    o.card(7, o.ROW1, "frontend", "key", "08", "Explicit Save", "API-05",
           "Only on submit — never automatic."),
    o.card(8, o.ROW1, "database", "save", "09", "Expense Stored", "MongoDB",
           "Category saved exactly as shown."),
]
s10 = o.card(8, o.ROW2, "insights", "chart", "10", "Feedback Row", "Server Derived",
             "Correction recomputed, not trusted.")
o.chain(t, o.R1_CY)
d.path([(t[8].cx, t[8].bottom), (t[8].cx, s10.y)], "insights", width=2.8,
       label="IF PREDICTED", label_at=(t[8].cx, o.LABEL_Y))
error_card(o, o.COL[8], 460, o.CW, "Telemetry can drift",
           ["A prediction survives a later", "bill prefill or edit load, so", "it can outlive its name."])
d.path([(s10.right, o.R2_CY), (1584, o.R2_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)
save(o, o.render(["Stages 01–07 touch no expense record at all. Stages 08–10 are the ordinary "
                  "create path, reused unchanged and cross-referenced rather than duplicated."],
                 "FLOW-01"),
     "flow-01-ml-assisted-entry-overview.svg")


# ===========================================================================
# FLOW-02 — retrieval-assisted expense edit
# ===========================================================================
o = new("Retrieval-assisted expense edit — loading, changing, saving",
        "Quick overview · follow 01 → 10 · one read hydrates the form, one write saves it")
d = o.d

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Read",       "GET /expense/expense-edit-data",        "backend"),
    ("Write",      "PUT /expense/update-expense — API-06",  "database"),
    ("Read cache", "expenses.detail(id), 5 min stale time", "frontend"),
    ("Prediction", "Suppressed while the name is loaded",   "insights"),
    ("Atomic",     "No — two requests, no transaction",     "error"),
])

d.note_box(882, 276, 516, 168, "Why the read is not a new API", [
    "The hydration route is a retrieval endpoint. It is shown here as an upstream "
    "dependency of the edit workflow, not counted as a mutation API.",
    "It is the one expense read outside the approved viewing set — see the consumption map.",
], "backend")

t = [
    o.card(0, o.ROW1, "ui", "list", "01", "Edit Icon", "ExpenseItem",
           "Stores the id, then navigates."),
    o.card(1, o.ROW1, "ui", "window", "02", "Edit Mode Opens", "AddExpense",
           "Same form, spinner while loading."),
    o.card(2, o.ROW1, "frontend", "database", "03", "Cached Detail Read", "fetchQuery",
           "Skips the network inside 5 minutes."),
    o.card(3, o.ROW1, "auth", "send", "04", "Retrieval Call", "Scoped by Owner",
           "Matched on id and userId together."),
    o.card(4, o.ROW1, "ui", "layout", "05", "Form Hydrated", "Five Fields",
           "Date trimmed to its day part."),
    o.card(5, o.ROW1, "insights", "shield", "06", "Prediction Held", "programmaticName",
           "The loaded category is protected."),
    o.card(6, o.ROW1, "ui", "cursor", "07", "User Edits", "Any Field",
           "Typing releases the prediction hold."),
    o.card(7, o.ROW1, "frontend", "key", "08", "Explicit Save", "API-06",
           "Whole form is sent, not a diff."),
    o.card(8, o.ROW1, "database", "save", "09", "Expense Updated", "Scoped $set",
           "Only whitelisted fields are written."),
]
s10 = o.card(8, o.ROW2, "frontend", "refresh", "10", "Caches Cleared", "Invalidate",
             "Expenses, budgets, reports, charts.")
o.chain(t, o.R1_CY)
d.path([(t[8].cx, t[8].bottom), (t[8].cx, s10.y)], "frontend", width=2.8,
       label="ON SUCCESS", label_at=(t[8].cx, o.LABEL_Y))
error_card(o, o.COL[8], 460, o.CW, "Stale hydration risk",
           ["Within the stale window the", "form can load a cached copy", "of an already-changed row."])
d.path([(s10.right, o.R2_CY), (1584, o.R2_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)
save(o, o.render(["The read is an upstream dependency, not a documented mutation. The write is "
                  "API-06, reused unchanged and cross-referenced rather than duplicated."],
                 "FLOW-02"),
     "flow-02-retrieval-assisted-edit-overview.svg")
