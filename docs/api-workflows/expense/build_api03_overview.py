"""
API-03 Level 1 — GET /expense/by-category  (default / yearly behaviour)

Same endpoint and same controller as API-02, taken through its ELSE branch. The
backend only special-cases `period === 'thismonth'`; every other value — including the
UI's 'thisyear' — falls through to the calendar-year path, which skips the three-month
history entirely and returns `pastThreeMonths: []`.

    row 1   01  02  03  04  05  06  ==HIT==>  10  11
    row 2                       07  08  09            12

Run:  python3 build_api02_overview.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))   # shared engine lives one level up

from workflow_diagram import Overview, load_tokens   # noqa: E402

o = Overview(load_tokens(),
             title="GET /expense/by-category — yearly category view (default branch)",
             subtitle="Quick overview · follow 01 → 12 · full detail in "
                      "api-03-category-thisyear-detailed.svg")
d = o.d
C, R1, R2 = o.COL, o.ROW1, o.ROW2

# ---------------------------------------------------------------------------
d.group_box(882, o.BAND_Y, 516, o.BAND_H, "Miss path", "database")

d.facts_panel(34, o.BAND_Y, 836, o.BAND_H, "At a glance", [
    ("Endpoint",     "GET /expense/by-category (else branch)",   "response"),
    ("Auth",         "Bearer JWT, checked every request",         "auth"),
    ("Server cache", "Redis · category:<user>:thismonth · 5 min", "database"),
    ("Database",     "MongoDB · one calendar-year query",         "database"),
    ("Returns",      "pastThreeMonths is always empty here",      "backend"),
])

# ---------------------------------------------------------------------------
s1 = o.card(0, R1, "ui", "layout", "01", "Category View Chosen", "ExpensesPage",
            "Filter By → Category, View By → This Year.")
s2 = o.card(1, R1, "frontend", "refresh", "02", "Fetch and Cache", "TanStack Query",
            "Resolves category mode + period.")
s3 = o.card(2, R1, "auth", "key", "03", "Authorized Request", "Axios Client",
            "Attaches the JWT, sends ?period.")
s4 = o.card(3, R1, "auth", "shield", "04", "API Security", "Limiter + JWT",
            "IP rate limit, then JWT validation.")
s5 = o.card(4, R1, "backend", "user-check", "05", "User Validation", "getByCategory",
            "Checks the user first, before any cache.")
s6 = o.card(5, R1, "database", "bolt", "06", "Cache Decision", "Redis Cache",
            "Key is category:<user>:thisyear.")
s10 = o.card(7, R1, "frontend", "refresh", "10", "Frontend Query Cache", "TanStack Query",
             "Stores it, exposes it to the page.")
s11 = o.card(8, R1, "insights", "chart", "11", "Insights", "Insights Engine",
             "Dominance level, stability, concentration.")

s7 = o.card(5, R2, "database", "database", "07", "Calendar Year Query", "MongoDB",
            "Jan 1 to Dec 31 of the current year.")
s8 = o.card(6, R2, "backend", "layers", "08", "Response Preparation", "Group by Category",
            "Sort newest first, then group by category.")
s9 = o.card(7, R2, "response", "send", "09", "Cache and Respond", "Redis Write + 200",
            "Caches 5 min, returns the payload.")
s12 = o.card(8, R2, "ui", "list", "12", "Category Display", "Category List",
             "One block and total per category.")

# two datasets from that single query
d.top.append(d._text(894, 452, "ONE YEAR QUERY → ONE DATASET", 9.6,
                     d.pal("database")["ink"], 700, ls=0.9))
d.dataset_chip(894, 462, 500, 26, "data", "the year, grouped by category")
d.dataset_chip(894, 496, 500, 26, "pastThreeMonths", "[] — never populated on this branch")

# ---------------------------------------------------------------------------
o.chain([s1, s2, s3, s4, s5, s6], o.R1_CY)
o.chain([s7, s8, s9], o.R2_CY)

d.path([(s6.right, o.R1_CY), (s10.x, o.R1_CY)], "database", width=2.8,
       label="CACHE HIT · cached 200 OK", label_at=(1144, o.R1_CY))
d.path([(s6.cx, s6.bottom), (s6.cx, s7.y)], "database", width=2.8,
       label="CACHE MISS", label_at=(s6.cx, o.LABEL_Y))
d.path([(s9.cx, s9.y), (s9.cx, s10.bottom)], "response", width=3.0,
       label="200 OK", label_at=(s9.cx, o.LABEL_Y))

d.path([(s10.right, o.R1_CY), (s11.x, o.R1_CY)], "insights", width=2.8)
d.path([(s10.right, o.R1_CY), (1408, o.R1_CY), (1408, o.R2_CY), (s12.x, o.R2_CY)],
       "ui", width=2.8)
d.top.append(d._text(C[8], o.LABEL_Y + 6, "PARALLEL CONSUMERS", 8.8,
                     d.n["inkFaint"], 700, ls=0.7))

# ---------------------------------------------------------------------------
ep = d.pal("error")
d.path([(s12.cx, s12.bottom), (s12.cx, 458)], "error", dashed=True)
d.mid.append('<g><rect x="%d" y="458" width="%d" height="98" rx="10" fill="%s" '
             'stroke="%s" stroke-width="1" stroke-dasharray="4 3"/>%s%s%s%s%s</g>'
             % (C[8], o.CW, ep["fill"], ep["border"],
                d._icon("alert", C[8] + 13, 470, ep["line"], 0.78),
                d._text(C[8] + 34, 483, "Request failure", 10.8, ep["ink"], 700),
                d._text(C[8] + 13, 506, "Current limitation:", 9.8, d.n["inkMuted"], 400),
                d._text(C[8] + 13, 519, "API errors can appear", 9.8, d.n["inkMuted"], 400),
                d._text(C[8] + 13, 532, "as “No Expenses”.", 9.8, d.n["inkMuted"], 400)))

svg = o.render(["Same controller and same route as API-02 — this is a response branch, not a "
                "separate endpoint. Any period value other than 'thismonth' lands here."],
               "BRANCH-01")
open(os.path.join(HERE, "api-03-category-thisyear-overview.svg"), "w",
     encoding="utf-8").write(svg)
print("wrote api-03-category-thisyear-overview.svg", len(svg), "bytes")
