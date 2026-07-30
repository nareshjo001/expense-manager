"""
API-01 Level 1 — quick workflow overview for GET /expense/last-week.

Twelve numbered stages, readable in 10-15 seconds at ~1200 px wide. The stage
numbers are reused as badges in the Level 2 detailed diagram, so the two views
cross-reference each other.

Grid: nine columns. Column 7 of row 1 is deliberately empty — it carries the
cache-hit short-circuit, which keeps the whole flow monotonically left-to-right
with no backward connectors.

    row 1   01  02  03  04  05  06  ==HIT==>  10  11
    row 2                       07  08  09            12

Run:  python3 build_overview.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))   # shared engine lives one level up

from workflow_diagram import Diagram, load_tokens   # noqa: E402

T = load_tokens()
O = T["overview"]
CW, CH = 156, 132
COL = [34, 206, 378, 550, 722, 894, 1066, 1238, 1418]     # col 9 nudged right
ROW1, ROW2 = 112, 306
R1_CY, R2_CY = ROW1 + CH / 2, ROW2 + CH / 2               # 178, 372
LABEL_Y = 268                                             # band between the rows

d = Diagram(T,
            title="GET /expense/last-week — how the last-week expense view loads",
            subtitle="Quick overview · follow 01 → 12 · full detail in api-01-last-week-detailed.svg",
            width=1600, height=645)
d.c = dict(d.c, titleBandHeight=56, margin=34, footerTop=576)
d.ty = dict(d.ty, railLabel={"size": 9.8, "weight": 700, "letterSpacing": 0.6})


def card(col, y, kind, icon, step, title, label, desc):
    return d.ocard(COL[col], y, CW, CH, kind, icon, step, title, label, desc)


# ---------------------------------------------------------------------------
# containers first, so cards sit on top
# ---------------------------------------------------------------------------
# label kept short so the CACHE MISS connector at x=972 never crosses it
d.group_box(882, 276, 516, 280, "Miss path", "database")

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",     "GET /expense/last-week",            "response"),
    ("Auth",         "Bearer JWT, checked every request", "auth"),
    ("Server cache", "Redis · one key per user · 5 min",  "database"),
    ("Database",     "MongoDB · one 42-day range query",  "database"),
    ("Client cache", "TanStack Query · 5 min stale time", "frontend"),
])

# ---------------------------------------------------------------------------
# row 1 — request out, then the response side
# ---------------------------------------------------------------------------
s1 = card(0, ROW1, "ui", "layout", "01", "Default Expense View", "ExpensesPage",
          "Opens the default last-week view.")
s2 = card(1, ROW1, "frontend", "refresh", "02", "Fetch and Cache", "TanStack Query",
          "Resolves last-week mode, starts fetch.")
s3 = card(2, ROW1, "auth", "key", "03", "Authorized Request", "Axios Client",
          "Attaches the stored JWT, sends it.")
s4 = card(3, ROW1, "auth", "shield", "04", "API Security", "Limiter + JWT",
          "IP rate limit, then JWT validation.")
s5 = card(4, ROW1, "backend", "gears", "05", "Request Processing", "lastWeekExpense",
          "Coordinates cache and database work.")
s6 = card(5, ROW1, "database", "bolt", "06", "Cache Decision", "Redis Cache",
          "Looks for a cached payload.")
s10 = card(7, ROW1, "frontend", "refresh", "10", "Frontend Query Cache", "TanStack Query",
           "Stores it, exposes it to the page.")
s11 = card(8, ROW1, "insights", "chart", "11", "Insights", "Insights Engine",
           "Weekly comparison + anomaly check.")

# ---------------------------------------------------------------------------
# row 2 — the cache-miss lane, plus the second parallel consumer
# ---------------------------------------------------------------------------
s7 = card(5, ROW2, "database", "database", "07", "Cache Miss Processing",
          "User Check + Mongo", "Checks user, then one 42-day query.")
s8 = card(6, ROW2, "backend", "layers", "08", "Response Preparation",
          "Organize Datasets", "Builds three datasets from it.")
s9 = card(7, ROW2, "response", "send", "09", "Cache and Respond",
          "Redis Write + 200", "Caches 5 min, returns the payload.")
s12 = card(8, ROW2, "ui", "list", "12", "Expense Display", "Expense List",
           "Groups and renders expense rows.")

# three datasets, all from that one query
d.top.append(d._text(894, 452, "ONE 42-DAY QUERY → THREE DATASETS", 9.6,
                     d.pal("database")["ink"], 700, ls=0.9))
for i, (name, desc) in enumerate([("data", "last 7 days"),
                                  ("previousData", "comparison period"),
                                  ("weeklyData", "historical weekly totals")]):
    d.dataset_chip(894, 460 + i * 30, 500, 26, name, desc)

# ---------------------------------------------------------------------------
# primary path — always left to right
# ---------------------------------------------------------------------------
for a, b in ((s1, s2), (s2, s3), (s3, s4), (s4, s5), (s5, s6)):
    d.path([(a.right, R1_CY), (b.x, R1_CY)], b.kind, width=2.8)
for a, b in ((s7, s8), (s8, s9)):
    d.path([(a.right, R2_CY), (b.x, R2_CY)], b.kind, width=2.8)

# cache hit — straight across the empty column, bypassing 07-09 entirely
d.path([(s6.right, R1_CY), (s10.x, R1_CY)], "database", width=2.8,
       label="CACHE HIT · cached 200 OK", label_at=(1144, R1_CY))

# cache miss — straight down into the lane below
d.path([(s6.cx, s6.bottom), (s6.cx, s7.y)], "database", width=2.8,
       label="CACHE MISS", label_at=(s6.cx, LABEL_Y))

# response returns straight up into the client cache
d.path([(s9.cx, s9.y), (s9.cx, s10.bottom)], "response", width=3.0,
       label="200 OK", label_at=(s9.cx, LABEL_Y))

# two parallel consumers of the same cached response
d.path([(s10.right, R1_CY), (s11.x, R1_CY)], "insights", width=2.8)
d.path([(s10.right, R1_CY), (1408, R1_CY), (1408, R2_CY), (s12.x, R2_CY)],
       "ui", width=2.8)
d.top.append(d._text(COL[8], LABEL_Y + 6, "PARALLEL CONSUMERS", 8.8,
                     d.n["inkFaint"], 700, ls=0.7))

# ---------------------------------------------------------------------------
# the one secondary path shown at this level
# ---------------------------------------------------------------------------
ep = d.pal("error")
d.path([(s12.cx, s12.bottom), (s12.cx, 458)], "error", dashed=True)
d.mid.append('<g><rect x="%d" y="458" width="%d" height="98" rx="10" fill="%s" '
             'stroke="%s" stroke-width="1" stroke-dasharray="4 3"/>%s%s%s%s%s</g>'
             % (COL[8], CW, ep["fill"], ep["border"],
                d._icon("alert", COL[8] + 13, 470, ep["line"], 0.78),
                d._text(COL[8] + 34, 483, "Request failure", 10.8, ep["ink"], 700),
                d._text(COL[8] + 13, 506, "Current limitation:", 9.8, d.n["inkMuted"], 400),
                d._text(COL[8] + 13, 519, "API errors can appear", 9.8, d.n["inkMuted"], 400),
                d._text(COL[8] + 13, 532, "as “No Expenses”.", 9.8, d.n["inkMuted"], 400)))

svg = d.render(
    meta_right="BALENISA · Personal Finance Platform",
    meta_left="docs/api-workflows · API-01 · Level 1 overview",
    footer_notes=[
        "A cache hit answers straight from Redis and skips stages 07–09. Everything else runs the full path.",
    ])
open(os.path.join(HERE, "api-01-last-week-overview.svg"), "w", encoding="utf-8").write(svg)
print("wrote api-01-last-week-overview.svg", len(svg), "bytes")
