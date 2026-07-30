"""INCOME-04 Level 1 — DELETE /income/delete

Write shape: the request runs left to right across row 1 to the controller, drops into
the database step in row 2, then the response rises back into row 1 and the client
finishes the flow. No backward connectors.

    row 1   01  02  03  04  05  06      09  10
    row 2                       07  08
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _income_common import new, error_card, no_redis_box   # noqa: E402

o = new("DELETE /income/delete — removing an income record", "Quick overview · follow 01 → 10 · full detail in income-api-04-delete-income-detailed.svg")
d, R1, R2 = o.d, o.ROW1, o.ROW2

d.facts_panel(34, o.BAND_Y, 836, o.BAND_H, "At a glance", [
    ("Endpoint",   "DELETE /income/delete",             "response"),
    ("Body",       "{ deleteIncomeId }",                "backend"),
    ("Validation", "Inline only — no Joi middleware",   "auth"),
    ("Ownership",  "Filter includes userId, so scoped", "auth"),
    ("Confirmation","None — one click deletes",         "error"),
])
no_redis_box(o, 1238, o.BAND_Y, 336, 168)

top = [
    o.card(0, R1, "ui", "cursor", "01", "Delete Button", "IncomeModal",
           "One click, no confirmation step."),
    o.card(1, R1, "frontend", "refresh", "02", "Delete Mutation", "TanStack Mutation",
           "useDeleteIncomeMutation fires."),
    o.card(2, R1, "auth", "key", "03", "Authorized Request", "Axios Client",
           "DELETE carrying a JSON body."),
    o.card(3, R1, "auth", "shield", "04", "API Security", "Limiter + JWT",
           "IP rate limit, then JWT validation."),
    o.card(4, R1, "backend", "user-check", "05", "User Validation", "deleteIncome",
           "Confirms the account still exists."),
    o.card(5, R1, "auth", "key", "06", "Id Validation", "isValidObjectId",
           "Rejects a malformed id with 400."),
]
bottom = [
    o.card(5, R2, "database", "save", "07", "Scoped Delete", "MongoDB",
           "findOneAndDelete on _id AND userId."),
    o.card(6, R2, "response", "send", "08", "Respond", "200 OK",
           "404 when nothing matched the filter."),
]
ret = [
    o.card(6, R1, "frontend", "refresh", "09", "Invalidate and Refetch", "TanStack Query",
           "Income and report keys are dropped."),
    o.card(7, R1, "ui", "monitor", "10", "List Refreshes", "IncomeModal",
           "Row disappears once the refetch lands."),
]
o.chain(top, o.R1_CY)
o.chain(bottom, o.R2_CY)
o.chain(ret, o.R1_CY)

d.path([(top[5].cx, top[5].bottom), (top[5].cx, bottom[0].y)], "backend", width=2.8,
       label="VALID ID", label_at=(top[5].cx, o.LABEL_Y))
d.path([(bottom[1].cx, bottom[1].y), (bottom[1].cx, ret[0].bottom)], "response", width=3.0,
       label="200 OK", label_at=(bottom[1].cx, o.LABEL_Y))

error_card(o, 1238, 460, 336, "No confirmation step", ["The trash button deletes", "immediately. There is no dialog", "and no undo path."])
# routed down the right margin: a straight drop would cross the note box
d.path([(ret[1].right, o.R1_CY), (1584, o.R1_CY), (1584, 502), (1574, 502)],
       "error", dashed=True)

svg = o.render(["Deletion is scoped by userId and cannot be undone; the UI offers no confirmation before the request is sent."], "INCOME-04")
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "income-api-04-delete-income-overview.svg"),
     "w", encoding="utf-8").write(svg)
print("wrote income-api-04-delete-income-overview.svg", len(svg))
