"""INCOME-02 Level 1 — POST /income/add

Write shape: the request runs left to right across row 1 to the controller, drops into
the database step in row 2, then the response rises back into row 1 and the client
finishes the flow. No backward connectors.

    row 1   01  02  03  04  05  06      09  10
    row 2                       07  08
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _income_common import new, error_card, no_redis_box   # noqa: E402

o = new("POST /income/add — recording a new income", "Quick overview · follow 01 → 10 · full detail in income-api-02-add-income-detailed.svg")
d, R1, R2 = o.d, o.ROW1, o.ROW2

d.facts_panel(34, o.BAND_Y, 836, o.BAND_H, "At a glance", [
    ("Endpoint",  "POST /income/add",                    "response"),
    ("Body",      "{ incomeSource, incomeAmount, incomeDate }", "backend"),
    ("Validation","Joi middleware, before the controller","auth"),
    ("Database",  "MongoDB · one insert",                "database"),
    ("On success","Invalidate income + reports, go home","frontend"),
])
no_redis_box(o, 1238, o.BAND_Y, 336, 168)

top = [
    o.card(0, R1, "ui", "layout", "01", "Add Income Form", "AddIncome",
           "Source, amount and date, all required."),
    o.card(1, R1, "frontend", "refresh", "02", "Add Mutation", "TanStack Mutation",
           "useAddIncomeMutation fires."),
    o.card(2, R1, "auth", "key", "03", "Authorized Request", "Axios Client",
           "POST with the JWT and the payload."),
    o.card(3, R1, "auth", "shield", "04", "API Security", "Limiter + JWT",
           "IP rate limit, then JWT validation."),
    o.card(4, R1, "auth", "file-text", "05", "Field Validation", "Joi Schema",
           "Source, positive amount, valid date."),
    o.card(5, R1, "backend", "user-check", "06", "User Validation", "addIncome",
           "Confirms the account still exists."),
]
bottom = [
    o.card(5, R2, "database", "save", "07", "Income Insert", "MongoDB",
           "new IncomeModel(...).save()."),
    o.card(6, R2, "response", "send", "08", "Respond", "201 Created",
           "Message only — no record returned."),
]
ret = [
    o.card(6, R1, "frontend", "refresh", "09", "Invalidate and Refetch", "TanStack Query",
           "Income and report keys are dropped."),
    o.card(7, R1, "ui", "monitor", "10", "Navigate and Toast", "AddIncome",
           "Returns to the expenses page."),
]
o.chain(top, o.R1_CY)
o.chain(bottom, o.R2_CY)
o.chain(ret, o.R1_CY)

d.path([(top[5].cx, top[5].bottom), (top[5].cx, bottom[0].y)], "backend", width=2.8,
       label="VALID PAYLOAD", label_at=(top[5].cx, o.LABEL_Y))
d.path([(bottom[1].cx, bottom[1].y), (bottom[1].cx, ret[0].bottom)], "response", width=3.0,
       label="201 CREATED", label_at=(bottom[1].cx, o.LABEL_Y))

error_card(o, 1238, 460, 336, "Validation rejected", ["Joi returns 400 before the", "controller runs. The form keeps", "its values and toasts the reason."])
# routed down the right margin: a straight drop would cross the note box
d.path([(ret[1].right, o.R1_CY), (1584, o.R1_CY), (1584, 502), (1574, 502)],
       "error", dashed=True)

svg = o.render(["Validation happens in middleware here, so an invalid payload never reaches the controller or the database."], "INCOME-02")
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "income-api-02-add-income-overview.svg"),
     "w", encoding="utf-8").write(svg)
print("wrote income-api-02-add-income-overview.svg", len(svg))
