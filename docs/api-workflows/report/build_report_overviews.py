"""
Level 1 overviews for the Reports / Analytics Engine module — one file, three outputs.

One public endpoint (REPORT-01) plus two internal flows: the Analytics Engine itself
(FLOW-01, no HTTP boundary) and the mutation-triggered refresh path (FLOW-02, which is
the synchronous call every Expense/Budget write already makes). All three reuse shapes
already approved elsewhere in the set; nothing new was added to the design system.

Run:  python3 build_report_overviews.py
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
    open(os.path.join(HERE, name), "w", encoding="utf-8").write(svg)
    print("wrote", name, len(svg))


# ===========================================================================
# REPORT-01 — GET /report
# Write-shape-with-hit-lane, same pattern as API-01 (last-week): a cache hit
# answers straight across row 1; a cache miss drops into row 2.
# ===========================================================================
o = new("GET /report — loading the financial report",
        "Quick overview · follow 01 → 11 · full detail in report-api-01-get-report-detailed.svg")
d, R1, R2 = o.d, o.ROW1, o.ROW2

d.group_box(882, 276, 704, 180, "Cache-miss path", "database",
            note="only reached when Redis has nothing cached",
            label_x=996, note_x=1180)

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Endpoint",   "GET /report",                              "response"),
    ("Server cache","Redis · report:<userId> · 1 hour TTL",    "database"),
    ("Engine",     "Deterministic analyzers — no ML, no SIA",  "insights"),
    ("Persistence","Mongo FinancialReport, one doc per user",  "database"),
    ("Client cache","TanStack Query · 5 min stale time",       "frontend"),
])

s1 = o.card(0, R1, "ui", "layout", "01", "Monthly Insights Page", "MonthlyInsightPage",
            "Mounts and immediately fetches.")
s2 = o.card(1, R1, "frontend", "refresh", "02", "Report Query", "useReport()",
            "One shared query, no parameters.")
s3 = o.card(2, R1, "auth", "key", "03", "Authenticated GET", "Axios + JWT",
            "Bearer token from localStorage.")
s4 = o.card(3, R1, "auth", "shield", "04", "API Security", "Limiter + JWT",
            "IP rate limit, then JWT validation.")
s5 = o.card(4, R1, "backend", "gears", "05", "Report Controller", "getReport()",
            "One try/catch around the whole service call.")
s6 = o.card(5, R1, "database", "bolt", "06", "Redis Lookup", "reportCache.get",
            "Keyed by report:<userId>.")
s10 = o.card(7, R1, "response", "send", "10", "200 OK", "Cached or Fresh Report",
             "Same schema either way.")
s11 = o.card(8, R1, "ui", "layout", "11", "Dashboard Render", "4 Components",
             "Header, budget card, insights, overall.")

s7 = o.card(5, R2, "database", "database", "07", "Mongo or Engine", "FinancialReport",
            "Stored doc if present, else full run.")
s8 = o.card(6, R2, "insights", "chart", "08", "Analytics Engine", "See FLOW-01",
            "Context, six analyzers, six scores.")
s9 = o.card(7, R2, "database", "save", "09", "Upsert and Cache", "Mongo + Redis",
            "Stores the result, then caches it.")

o.chain([s1, s2, s3, s4, s5, s6], o.R1_CY)
o.chain([s7, s8, s9], o.R2_CY)
d.path([(s6.right, o.R1_CY), (s10.x, o.R1_CY)], "database", width=2.8,
       label="CACHE HIT · report:<userId>", label_at=(1144, o.R1_CY))
d.path([(s6.cx, s6.bottom), (s7.y, s7.y)] if False else [(s6.cx, s6.bottom), (s6.cx, s7.y)],
       "database", width=2.8, label="CACHE MISS", label_at=(s6.cx, o.LABEL_Y))
d.path([(s9.cx, s9.y), (s9.cx, s10.bottom)], "response", width=3.0,
       label="200 OK", label_at=(s9.cx, o.LABEL_Y))
d.path([(s10.right, o.R1_CY), (s11.x, o.R1_CY)], "ui", width=2.8)

error_card(o, o.COL[8], 460, o.CW, "One failure code",
           ["Any analyzer or database", "error collapses to a", "generic 500."])
d.path([(s11.right, o.R1_CY), (1584, o.R1_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)

save(o, o.render(["A cache hit answers straight from Redis and skips 07-09 entirely. A stored "
                  "Mongo document is served as-is on a miss — it is not recomputed."],
                 "REPORT-01"),
     "report-api-01-get-report-overview.svg")


# ===========================================================================
# FLOW-01 — the Analytics Engine
# Read-shape: no HTTP boundary at all, so every stage runs across one row.
# ===========================================================================
o = new("The Analytics Engine — from raw records to a financial report",
        "Quick overview · follow 01 → 09 · internal engine, no endpoint of its own")
d, R1, R2 = o.d, o.ROW1, o.ROW2

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Trigger",    "generateReport(userId) — cache miss or refresh", "backend"),
    ("Queries",    "5 parallel Mongo reads build one context",       "database"),
    ("Analyzers",  "6 deterministic modules — no model, no ML",      "insights"),
    ("Scores",     "6 calculators, weighted into one health score",  "insights"),
    ("Output",     "One report object — cached and persisted",      "response"),
])

d.note_box(882, 276, 516, 168, "Deterministic, not ML", [
    "Every analyzer and score calculator is arithmetic over the user's own records — "
    "thresholds and formulas, not a trained model.",
    "The ML Service and SIA are not called anywhere in this pipeline.",
], "insights")

t = [
    o.card(0, R1, "backend", "gears", "01", "Engine Invoked", "generateReport()",
           "Called on a cache miss or a refresh."),
    o.card(1, R1, "database", "database", "02", "Parallel Queries", "Promise.all x 5",
           "Two years of expenses, all budgets."),
    o.card(2, R1, "insights", "layers", "03", "Context Normalized", "analyticsContext",
           "Budget history, trend windows, day count."),
    o.card(3, R1, "insights", "chart", "04", "Analyzer Fan-out", "6 Analyzers",
           "Spending, budget, category x2, trend, habit x2."),
    o.card(4, R1, "insights", "sigma", "05", "Score Calculation", "6 Calculators",
           "Each normalized to a 0-100 scale."),
    o.card(5, R1, "insights", "bolt", "06", "Health Aggregation", "Weighted Average",
           "Missing modules excluded, not zeroed."),
    o.card(6, R1, "backend", "layers", "07", "Report Assembly", "assembleReport()",
           "One object: summary, sections, health."),
    o.card(7, R1, "response", "send", "08", "Cache-ready Output", "Returned to caller",
           "Handed back to reportService."),
]
s09 = o.card(8, R2, "database", "save", "09", "Persist and Cache", "Mongo + Redis",
             "The caller does both — see REPORT-01.")
o.chain(t, o.R1_CY)
d.path([(t[7].cx, t[7].bottom), (t[7].cx, s09.y)], "database", width=2.8,
       label="RETURNED", label_at=(t[7].cx, o.LABEL_Y))

error_card(o, o.COL[8], 460, o.CW, "One analyzer, one failure",
           ["Any analyzer throwing aborts", "the whole engine call — there", "is no partial report."])
d.path([(s09.right, o.R2_CY), (1584, o.R2_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)

save(o, o.render(["The engine has no HTTP boundary of its own. It is invoked exactly two ways: "
                  "a cache-miss read (REPORT-01) or a mutation-triggered refresh (FLOW-02)."],
                 "FLOW-01"),
     "report-flow-01-analytics-engine-overview.svg")


# ===========================================================================
# FLOW-02 — mutation-triggered refresh
# Write-shape: the mutation's own request carries the refresh; the response
# genuinely waits for it, which is the point of this diagram.
# ===========================================================================
o = new("Mutation-triggered Report refresh — synchronous, not background",
        "Quick overview · follow 01 → 09 · runs inside the mutation's own request")
d, R1, R2 = o.d, o.ROW1, o.ROW2

d.facts_panel(34, 276, 836, 280, "At a glance", [
    ("Triggers",   "Expense create/update/delete, Budget set/update", "database"),
    ("Not a trigger", "Income and the recurring toggle — never call it", "error"),
    ("Runs",       "Synchronously, awaited before the HTTP response", "backend"),
    ("On failure", "The whole mutation answers 500 — see the note",  "error"),
    ("Async?",     "No — nothing is queued or backgrounded",         "error"),
])

d.note_box(882, 276, 516, 168, "The response waits", [
    "refreshReport is awaited before the mutation's own res.status(...) call, so a "
    "successful save is followed by a full report recompute before the client hears "
    "back.",
    "If that recompute throws, the response is 500 even though the write already "
    "committed.",
], "error")

t = [
    o.card(0, R1, "database", "save", "01", "Mutation Commits", "e.g. addExpense",
           "The document is already saved."),
    o.card(1, R1, "database", "gears", "02", "Budget + Cache", "recalculateBudget",
           "Expense's own propagation, not Report's."),
    o.card(2, R1, "backend", "refresh", "03", "Refresh Called", "refreshReport(userId)",
           "Awaited, not fired-and-forgotten."),
    o.card(3, R1, "database", "bolt", "04", "Cache Dropped", "reportCache.invalidate",
           "Redis key deleted before recomputing."),
    o.card(4, R1, "insights", "chart", "05", "Full Recompute", "generateReport()",
           "Same engine as FLOW-01, no shortcuts."),
    o.card(5, R1, "database", "save", "06", "Mongo Upsert", "findOneAndUpdate",
           "Overwrites the stored report."),
    o.card(6, R1, "database", "database", "07", "Redis Repopulated", "reportCache.set",
           "Fresh report cached for 1 hour."),
    o.card(7, R1, "response", "send", "08", "Mutation Responds", "201 / 200 OK",
           "Only now does the original request return."),
]
s09 = o.card(8, R2, "frontend", "key", "09", "Report Marked Stale", "invalidateQueries",
             "Frontend refetches; usually a cache hit.")
o.chain(t, o.R1_CY)
d.path([(t[7].cx, t[7].bottom), (t[7].cx, s09.y)], "frontend", width=2.8,
       label="ON SUCCESS", label_at=(t[7].cx, o.LABEL_Y))

error_card(o, o.COL[8], 460, o.CW, "Failure after commit",
           ["If step 03-07 throws, the", "expense is saved but the", "client is told it failed."])
d.path([(s09.right, o.R2_CY), (1584, o.R2_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)

save(o, o.render(["This is the same refreshReport already documented as a propagation step in "
                  "Expense API-05/06/07 and Budget BUDGET-02/03. Shown here as its own flow "
                  "because its failure boundary is significant enough to warrant one."],
                 "FLOW-02"),
     "report-flow-02-mutation-refresh-overview.svg")
