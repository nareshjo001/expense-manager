"""
API-04 Level 1 — GET /expense/search?startDate&endDate

Ten stages, not twelve. This route has **no Redis layer at all** — no getCache, no
setCache — so there is no cache decision, no hit/miss branch and no short-circuit
column. It also produces no insight card: ExpensesPage only notifies the insights
engine for filter '' and 'bycategory'. The layout reflects that honestly rather than
forcing the API-01 shape.

    row 1   01  02  03  04  05  06  07  08  09
    row 2                                     10

Run:  python3 build_api04_overview.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))   # shared engine lives one level up

from workflow_diagram import Overview, load_tokens   # noqa: E402

o = Overview(load_tokens(),
             title="GET /expense/search — custom date-range expense view",
             subtitle="Quick overview · follow 01 → 10 · full detail in "
                      "api-04-custom-range-detailed.svg")
d = o.d
C, R1, R2 = o.COL, o.ROW1, o.ROW2

# ---------------------------------------------------------------------------
d.facts_panel(34, o.BAND_Y, 836, o.BAND_H, "At a glance", [
    ("Endpoint",     "GET /expense/search?startDate&endDate", "response"),
    ("Auth",         "Bearer JWT, checked every request",     "auth"),
    ("Server cache", "None — no getCache, no setCache",       "database"),
    ("Database",     "MongoDB · one caller-supplied range",   "database"),
    ("Insights",     "Not invoked for this filter",           "insights"),
])

d.note_box(882, o.BAND_Y, 516, 130, "Two layers are absent here", [
    "No Redis: every request reads MongoDB directly, so there is no hit/miss branch "
    "and nothing is written back.",
    "No insights: the ExpensesPage effect only fires for the default and category "
    "filters, so no Spending Overview card appears.",
], "database")

# ---------------------------------------------------------------------------
s1 = o.card(0, R1, "ui", "layout", "01", "Custom Range Chosen", "ExpensesPage",
            "Modal collects a start and end date.")
s2 = o.card(1, R1, "frontend", "refresh", "02", "Fetch and Cache", "TanStack Query",
            "Stays disabled until both dates exist.")
s3 = o.card(2, R1, "auth", "key", "03", "Authorized Request", "Axios Client",
            "Attaches the JWT, sends both dates.")
s4 = o.card(3, R1, "auth", "shield", "04", "API Security", "Limiter + JWT",
            "IP rate limit, then JWT validation.")
s5 = o.card(4, R1, "backend", "user-check", "05", "Request Validation", "getByCustom",
            "Checks the user, then both date params.")
s6 = o.card(5, R1, "database", "database", "06", "Range Query", "MongoDB",
            "Direct read — no cache is consulted.")
s7 = o.card(6, R1, "backend", "layers", "07", "Response Preparation", "Sort Ascending",
            "Oldest to newest across the range.")
s8 = o.card(7, R1, "response", "send", "08", "Respond", "200 OK",
            "Returns data. Nothing is cached.")
s9 = o.card(8, R1, "frontend", "refresh", "09", "Frontend Query Cache", "TanStack Query",
            "Keyed on the two chosen dates.")

s10 = o.card(8, R2, "ui", "list", "10", "Range Display", "Expense List",
             "One block labelled with the date range.")

# ---------------------------------------------------------------------------
o.chain([s1, s2, s3, s4, s5, s6, s7, s8, s9], o.R1_CY)
d.path([(s9.cx, s9.bottom), (s9.cx, s10.y)], "ui", width=2.8,
       label="SINGLE CONSUMER", label_at=(s9.cx, o.LABEL_Y))

# single dataset
d.top.append(d._text(894, 452, "ONE RANGE QUERY → ONE DATASET", 9.6,
                     d.pal("database")["ink"], 700, ls=0.9))
d.dataset_chip(894, 462, 500, 26, "data", "the requested range, oldest first")

# ---------------------------------------------------------------------------
ep = d.pal("error")
d.path([(s10.cx, s10.bottom), (s10.cx, 458)], "error", dashed=True)
d.mid.append('<g><rect x="%d" y="458" width="%d" height="98" rx="10" fill="%s" '
             'stroke="%s" stroke-width="1" stroke-dasharray="4 3"/>%s%s%s%s%s</g>'
             % (C[8], o.CW, ep["fill"], ep["border"],
                d._icon("alert", C[8] + 13, 470, ep["line"], 0.78),
                d._text(C[8] + 34, 483, "Request failure", 10.8, ep["ink"], 700),
                d._text(C[8] + 13, 506, "Current limitation:", 9.8, d.n["inkMuted"], 400),
                d._text(C[8] + 13, 519, "API errors can appear", 9.8, d.n["inkMuted"], 400),
                d._text(C[8] + 13, 532, "as “No Expenses”.", 9.8, d.n["inkMuted"], 400)))

svg = o.render(["Ten stages, not twelve — this route has no Redis layer and no insights "
                "consumer, so those stages genuinely do not exist."], "API-04")
open(os.path.join(HERE, "api-04-custom-range-overview.svg"), "w",
     encoding="utf-8").write(svg)
print("wrote api-04-custom-range-overview.svg", len(svg), "bytes")
