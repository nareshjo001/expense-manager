"""
BUDGET-01 Level 1 — GET /api/getbudgets

Ten stages. This route has **no Redis layer at all** — no getCache, no setCache, no
key, no TTL — so there is no cache decision and no hit/miss branch. The layout
reflects that rather than borrowing the Expense-module shape.

    row 1   01  02  03  04  05  06  07  08  09
    row 2                                     10

Run:  python3 build_budget01_overview.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))   # shared engine lives one level up

from workflow_diagram import Overview, load_tokens   # noqa: E402

o = Overview(load_tokens(),
             title="GET /api/getbudgets — how budget data reaches the UI",
             subtitle="Quick overview · follow 01 → 10 · full detail in "
                      "budget-api-01-get-budgets-detailed.svg")
d = o.d
C, R1, R2 = o.COL, o.ROW1, o.ROW2

# ---------------------------------------------------------------------------
d.facts_panel(34, o.BAND_Y, 836, o.BAND_H, "At a glance", [
    ("Endpoint",     "GET /api/getbudgets",                "response"),
    ("Auth",         "Bearer JWT, checked every request",  "auth"),
    ("Server cache", "None — no Redis on this route",      "database"),
    ("Database",     "MongoDB · every month the user owns", "database"),
    ("Client cache", "TanStack Query · key [\"budgets\"]",   "frontend"),
])

d.note_box(882, o.BAND_Y, 516, 150, "One read, two consumers", [
    "Every budget document the user owns is returned — no month filter, no "
    "pagination, no Redis layer and no server-side aggregation.",
    "The same response feeds the budget bar on the expenses page and the budget "
    "card in the monthly-insights header.",
], "database")

# ---------------------------------------------------------------------------
s1 = o.card(0, R1, "ui", "layout", "01", "Budget Panel Mounts", "SetBudget",
            "Rendered at the top of ExpensesPage.")
s2 = o.card(1, R1, "frontend", "refresh", "02", "Budget Query", "TanStack Query",
            "One shared query, key [\"budgets\"].")
s3 = o.card(2, R1, "auth", "key", "03", "Authorized Request", "Axios Client",
            "Attaches the stored JWT, sends it.")
s4 = o.card(3, R1, "auth", "shield", "04", "API Security", "Limiter + JWT",
            "IP rate limit, then JWT validation.")
s5 = o.card(4, R1, "backend", "user-check", "05", "User Validation", "getbudgets",
            "Confirms the account still exists.")
s6 = o.card(5, R1, "database", "database", "06", "Budget Read", "MongoDB",
            "All months for this user, then sorted.")
s7 = o.card(6, R1, "response", "send", "07", "Respond", "200 OK",
            "Returns the whole budget history.")
s8 = o.card(7, R1, "frontend", "refresh", "08", "Cache and Summarise", "useBudgetSummary",
            "Derives status and the month's total.")
s9 = o.card(8, R1, "ui", "chart", "09", "Budget Bar", "BudgetBar",
            "Progress bar for the current month.")

s10 = o.card(8, R2, "ui", "monitor", "10", "Insights Header", "Header",
             "Budget card on the insights page.")

# ---------------------------------------------------------------------------
o.chain([s1, s2, s3, s4, s5, s6, s7, s8, s9], o.R1_CY)
d.path([(s8.right, o.R1_CY), (1406, o.R1_CY), (1406, o.R2_CY), (s10.x, o.R2_CY)],
       "ui", width=2.8)
d.top.append(d._text(C[8], o.LABEL_Y + 6, "PARALLEL CONSUMERS", 8.8,
                     d.n["inkFaint"], 700, ls=0.7))

# ---------------------------------------------------------------------------
ep = d.pal("error")
d.path([(s10.cx, s10.bottom), (s10.cx, 458)], "error", dashed=True)
d.mid.append('<g><rect x="%d" y="458" width="%d" height="98" rx="10" fill="%s" '
             'stroke="%s" stroke-width="1" stroke-dasharray="4 3"/>%s%s%s%s%s</g>'
             % (C[8], o.CW, ep["fill"], ep["border"],
                d._icon("alert", C[8] + 13, 470, ep["line"], 0.78),
                d._text(C[8] + 34, 483, "Request failure", 10.8, ep["ink"], 700),
                d._text(C[8] + 13, 506, "The budget panel shows", 9.8, d.n["inkMuted"], 400),
                d._text(C[8] + 13, 519, "“Network Error”; the header", 9.8, d.n["inkMuted"], 400),
                d._text(C[8] + 13, 532, "still shows ₹ 0.", 9.8, d.n["inkMuted"], 400)))

svg = o.render(["Budget data is never cached server-side. The only cache in this flow is "
                "TanStack Query in the browser."], "BUDGET-01")
open(os.path.join(HERE, "budget-api-01-get-budgets-overview.svg"), "w",
     encoding="utf-8").write(svg)
print("wrote budget-api-01-get-budgets-overview.svg", len(svg), "bytes")
