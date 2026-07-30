"""INCOME-01 Level 1 — GET /income/get

Nine stages in one straight row. No Redis, no branch, and the query is gated: it only
runs while IncomeModal is open.

    row 1   01  02  03  04  05  06  07  08  09
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _income_common import new, error_card, no_redis_box   # noqa: E402

o = new("GET /income/get — listing every recorded income",
        "Quick overview · follow 01 → 09 · full detail in income-api-01-list-income-detailed.svg")
d, R1 = o.d, o.ROW1

d.facts_panel(34, o.BAND_Y, 836, o.BAND_H, "At a glance", [
    ("Endpoint",     "GET /income/get",                    "response"),
    ("Auth",         "Bearer JWT, checked every request",  "auth"),
    ("Server cache", "None — no Redis on this route",      "database"),
    ("Database",     "MongoDB · every record, newest first", "database"),
    ("Fetch trigger", "Only while IncomeModal is open",     "frontend"),
])
no_redis_box(o, 882, o.BAND_Y, 516)

s = [
    o.card(0, R1, "ui", "cursor", "01", "Income Modal Opens", "IncomeModal",
           "Opened from the income insights header."),
    o.card(1, R1, "frontend", "refresh", "02", "Gated Query", "TanStack Query",
           "enabled follows the modal's open state."),
    o.card(2, R1, "auth", "key", "03", "Authorized Request", "Axios Client",
           "Attaches the stored JWT, sends it."),
    o.card(3, R1, "auth", "shield", "04", "API Security", "Limiter + JWT",
           "IP rate limit, then JWT validation."),
    o.card(4, R1, "backend", "user-check", "05", "User Validation", "getIncome",
           "Confirms the account still exists."),
    o.card(5, R1, "database", "database", "06", "Income Read", "MongoDB",
           "All records, sorted newest date first."),
    o.card(6, R1, "response", "send", "07", "Respond", "200 OK",
           "Returns the full income history."),
    o.card(7, R1, "frontend", "refresh", "08", "Client Cache", "TanStack Query",
           "Key [\"income\",\"list\"], 5 min stale."),
    o.card(8, R1, "ui", "list", "09", "Income List", "IncomeModal",
           "One card per record, with edit/delete."),
]
o.chain(s, o.R1_CY)

error_card(o, o.COL[8], 458, o.CW, "Request failure",
           ["A toast fires and the list", "renders “No income records", "found.” — same as empty."])
d.path([(s[8].cx, s[8].bottom), (s[8].cx, 458)], "error", dashed=True)

svg = o.render(["The list is never fetched on page load — only when the modal opens, and it stays "
                "cached for five minutes afterwards."], "INCOME-01")
open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                  "income-api-01-list-income-overview.svg"), "w", encoding="utf-8").write(svg)
print("wrote income-api-01-list-income-overview.svg", len(svg))
