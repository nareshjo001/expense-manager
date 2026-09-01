"""
Level 2 detailed diagrams for the Reports / Analytics Engine module — one file,
three outputs: the public endpoint, the internal engine, and the mutation-triggered
refresh path. Every card string is traced to source. The engine is deterministic —
thresholds and formulas over the user's own records — so no card claims a model or an
ML/SIA call; their absence is stated in a note rather than a drawn dependency.

Run:  python3 build_report_detailed.py
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
TOKEN_CARD = ("auth", "key", "AXIOS", "Token Attached", "api.interceptors.request",
              "Adds Authorization: Bearer <token> from localStorage.")

FOOT = ("Heavy arrows are region hand-offs; the cyan one is the HTTP response. Light "
        "arrows are steps inside a region. A layer that does not exist — ML, SIA, a "
        "queue — is drawn as a note, never as an implemented step.")

BAND_401 = ("E2", "401 Unauthorized", "verifyToken()",
            "Missing Bearer header, malformed payload, or expired JWT. The axios "
            "interceptor then calls forceReauth().")
BAND_429 = ("E1", "429 Too Many Requests", "apiLimiter",
            "More than 150 requests in 15 minutes from the same IP address.")


def base(title, subtitle, labels):
    d = Diagram(T, title=title, subtitle=subtitle)
    r = [d.region(x, w, lab, sub, accent=accent, step=i + 1)
         for i, (x, w, lab, sub, accent) in enumerate(labels)]
    return d, r


def col(region, i):
    return region.card_x, Y0 + i * PITCH


def stack(d, region, specs, start=0):
    made = []
    for i, sp in enumerate(specs):
        kind, icon, kicker, stage, impl, purpose = sp[:6]
        extra = sp[6] if len(sp) > 6 else {}
        made.append(d.card(*col(region, start + i), kind, icon, kicker, stage, impl,
                           purpose, **extra))
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
    directory = "get-report" if out.startswith("report-api-01") else (
        "flow/analytics-engine" if out.startswith("report-flow-01") else "flow/mutation-refresh")
    path = os.path.join(HERE, directory, out)
    open(path, "w", encoding="utf-8").write(svg)
    print("wrote", os.path.relpath(path, HERE), len(svg))


def region5(d, src, head, left_label, left, right_label, right, note):
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


# ===========================================================================
# REPORT-01 — GET /report
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "GET /report — detailed implementation workflow",
    "Level 2 · real functions, middleware and models · badges map to the 11 stages in "
    "report-api-01-get-report-overview.svg",
    [(20, 272, "User & Report Interface", "Page mount, four sections", "ui"),
     (306, 272, "TanStack Query & Network", "One shared query, no params", "frontend"),
     (592, 272, "Security & Controller", "Middleware chain, in order", "auth"),
     (878, 272, "Redis Cache & Mongo Fallback", "Cache-first, engine on true miss", "database"),
     (1164, 496, "Response & Dashboard", "Same schema, cached or fresh", "insights")])

a = stack(d, r1, [
    ("ui", "layout", "COMPONENT", "Monthly Insights Page", "MonthlyInsightPage.js",
     "Fetches once on mount; no filters or params exist.", {"step": "01"}),
    ("ui", "list", "SECTIONS", "Four Consumers", "Header, Budget, Spending, Overall",
     "Every section reads the one shared report object.", {"step": "01"}),
    ("ui", "cursor", "GUARD", "Nested Field Access", "report?.summary ?? {}",
     "Each section defaults its own slice — see E5.", {"step": "01", "tag": "E5"}),
])
b = stack(d, r2, [
    ("frontend", "refresh", "TANSTACK", "Report Query", "useReport()",
     "queryKey ['reports'] — no filters, one entry for the user.", {"step": "02"}),
    ("frontend", "gauge", "CONFIG", "Client Defaults", "staleTime 5m, retry 1",
     "No custom overrides — same defaults as every other query.", {"step": "02"}),
    TOKEN_CARD + ({"step": "03"},),
])
c = stack(d, r3, [
    LIMITER_CARD + ({"step": "04", "tag": "E1"},),
    VERIFY_CARD + ({"step": "04", "tag": "E2"},),
    ("backend", "gears", "CONTROLLER", "Report Handler", "getReport()",
     "One try/catch around the entire service call.", {"step": "05"}),
])
e = stack(d, r4, [
    ("database", "bolt", "REDIS", "Cache Lookup", "getWithRevision(userId)",
     "Key report:<userId>. Parse failures degrade to a miss.",
     {"step": "06", "tag": "E3"}),
    ("database", "database", "MONGODB", "Stored Report", "FinancialReport.findOne",
     "Served only if contract-current and revision-fresh.",
     {"step": "07", "tag": "E4"}),
    ("insights", "chart", "ENGINE", "Analytics Engine", "generateReport() — see FLOW-01",
     "Runs for a missing, stale, or recovery-pending report.", {"step": "08"}),
])
grp = d.pill_group(r4.card_x, e[-1].bottom + 6, CW, "then, on a true miss",
                   [("FinancialReport.findOneAndUpdate", "upsert"),
                    ("reportCache.set", "EX 3600")])
e5 = d.card(r4.card_x, grp.bottom + 14, "response", "send", "RESPONSE",
            "200 OK", "the report object",
            "Identical schema whether served from cache, Mongo or fresh.",
            step="09")
d.path([(e[-1].cx, e[-1].bottom), (e[-1].cx, grp.y)], "database")
d.path([(grp.cx, grp.bottom), (grp.cx, e5.y)], "database")
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)

f0, g, h = region5(
    d, e5,
    ("frontend", "database", "CLIENT CACHE", "Query Cached", "queryKeys.reports.all",
     "5 min stale time; a mutation elsewhere can invalidate it early.",
     {"step": "10"}),
    "What gets rendered", [
        ("ui", "monitor", "COMPONENT", "Header", "summary fields",
         "Total spent, daily average, top category.", {}),
        ("ui", "layout", "COMPONENT", "Budget Intelligence", "budgets + insights",
         "Utilization bar and the single insight message.", {}),
        ("ui", "chart", "COMPONENT", "Spending / Overall", "categories, habits, spending",
         "financialHealth is fetched but never read here.", {"tag": "E6"}),
    ],
    "Loading and empty states", [
        ("ui", "gauge", "LOADING", "Spinner Only", "isLoading",
         "No skeleton, no partial-section rendering.", {}),
        ("ui", "alert", "ERROR", "One Message", "\"Failed to load report.\"",
         "Identical text for a network error and a 500.", {}),
        ("ui", "cursor", "REFRESH", "No Manual Button", "mount-fetch only",
         "No focus/reconnect refetch — turned off client-wide.", {}),
    ],
    ("Cache-hit vs cache-miss", [
        "A Redis hit answers in one round trip. A true miss — no Mongo document either — "
        "runs the full engine before responding, inside the same request.",
        "There is no background refresh; the caller always waits.",
    ], "database"))

x = band(d, [
    BAND_429, BAND_401,
    ("E3", "Corrupted Cache Treated as Miss", "reportCache.get catch",
     "JSON.parse failure is caught, logged and returns null — falls through to Mongo "
     "rather than crashing the request."),
    ("E4", "Stale Reports Are Regenerated", "PendingSync revision + contract check",
     "A stored or cached report below the durable revision floor is bypassed and regenerated."),
    ("E5", "Missing Nested Fields", "optional chaining throughout",
     "Every consumer defaults its own slice (?? {}), so a malformed report degrades "
     "per-section rather than crashing the page."),
    ("E6", "financialHealth Has No Reader", "grep across components",
     "The score, risk label and signals are computed, cached and returned, but no "
     "frontend component renders any of them."),
])
refs(d, [(pt, rail, gi, x[i], enter) for i, (pt, rail, gi, enter) in enumerate([
    ((c[0].right, c[0].cy), 852, 0, "left"),
    ((c[1].x, c[1].cy), 604, 1, "top-offset"),
    ((e[0].right, e[0].cy), 1146, 2, "top"),
    ((e[1].right, e[1].cy), 1146, 3, "top"),
    ((a[2].cx, a[2].bottom), a[2].cx, 4, "top"),
    ((h[2].right, h[2].cy), 1584, 5, "top"),
])])
finish(d, "report-api-01-get-report-detailed.svg", "REPORT-01",
       "A cache hit and a cache miss return the same shape. The engine itself is "
       "traced separately in FLOW-01 rather than repeated inside this diagram.")


# ===========================================================================
# FLOW-01 — the Analytics Engine
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "The Analytics Engine — detailed internal workflow",
    "Level 2 · real functions and formulas · badges map to the 9 stages in "
    "report-flow-01-analytics-engine-overview.svg",
    [(20, 272, "Trigger & Raw Queries", "5 parallel, user-scoped reads", "database"),
     (306, 496, "Context Normalization", "Budget history, trend windows, day count", "insights"),
     (802, 340, "Analyzer Fan-out", "6 deterministic modules", "insights"),
     (1142, 226, "Score Calculation", "6 calculators, one weighted average", "insights"),
     (1368, 292, "Assembly & Cache Boundary", "One object, handed back to REPORT-01", "response")])

a = stack(d, r1, [
    ("backend", "gears", "TRIGGER", "Engine Invoked", "generateReport(userId)",
     "Called only from a cache miss or refreshReport.", {"step": "01"}),
    ("database", "database", "MONGODB", "5 Parallel Queries", "Promise.all",
     "Current/previous month, current/previous year, all budgets.",
     {"step": "02", "tag": "E5"}),
    ("database", "user-check", "OWNERSHIP", "userId in Every Filter", "ExpenseModel.find({userId,...})",
     "Same scoping as every other Expense/Budget read.", {"step": "02"}),
])
b = stack(d, r2, [
    ("insights", "layers", "MERGE", "Budget History Built", "currentMonthEntry + past months",
     "Current month is computed from live expenses, not the budget doc's own spent.",
     {"step": "03"}),
    ("insights", "gauge", "WINDOWS", "Trend Windows", "today/week/quarter, +/- 1",
     "Built from a pooled current+previous-year array to survive Jan 1st.",
     {"step": "03", "tag": "E6"}),
    ("insights", "sigma", "DERIVED", "Day Count", "daysInMonth",
     "new Date(y, m+1, 0).getDate() — correct through leap years.", {"step": "03"}),
    ("error", "alert", "SILENT DEFAULT", "Update Timestamps", "lastExpenseUpdate ?? null",
     "The context never sets these fields — always null downstream.",
     {"step": "03", "tag": "E7"}),
])
c = stack(d, r3, [
    ("insights", "sigma", "ANALYZER", "Spending", "spendingAnalyzer.analyze",
     "Totals, daily average, weekly coefficient of variation.", {"step": "04"}),
    ("insights", "gauge", "ANALYZER", "Budget", "budgetAnalyzer.analyze",
     "Utilization, streak, linear-projection forecast.", {"step": "04"}),
    ("insights", "chart", "ANALYZER", "Category x2", "categoryAnalyzer.analyze",
     "Run once for the month, once for the year.", {"step": "04"}),
    ("insights", "bolt", "ANALYZER", "Trend", "trendAnalyzer.analyze",
     "Weighted daily/weekly/monthly/quarterly direction.", {"step": "04"}),
    ("insights", "list", "ANALYZER", "Habit x2", "habitAnalyzer.analyze",
     "Monthly and yearly — five sub-metrics each.", {"step": "04"}),
])
e = stack(d, r4, [
    ("insights", "sigma", "CALCULATORS", "5 Score Modules", "budget/spending/category/trend/habit",
     "Each tiered against its own analyzer's output.", {"step": "05"}),
    ("insights", "list", "INPUT", "Habit Data Included", "healthAnalyzer({ habits })",
     "The monthly habit report feeds health scoring and signals.",
     {"step": "05", "tag": "E1"}),
    ("insights", "gears", "AGGREGATE", "Health Score", "weighted average, renormalized",
     "Missing modules excluded, never treated as zero.", {"step": "06", "tag": "E2"}),
])
nb = d.note_box(r4.card_x, e[-1].bottom + 12, r4.w - 2 * L["regionPaddingX"], 150,
                "No ML or SIA in this path", [
    "Every formula above is deterministic arithmetic over the user's own records.",
    "Neither the ML Service nor SIA is called anywhere in the engine.",
], "insights")

RW = r5.w - 2 * L["regionPaddingX"]
f0 = d.card(r5.card_x, Y0, "backend", "layers", "ASSEMBLY", "assembleReport()",
            "metadata, summary, 6 sections, financialHealth",
            "One object — this is the exact shape cached and persisted.",
            w=RW, step="07")
f1 = d.card(r5.card_x, f0.bottom + 14, "insights", "gauge", "SUMMARY",
            "summary.healthScore", "healthReport values",
            "Health score and risk level are copied into the summary.",
            w=RW, step="07", tag="E3")
f2 = d.card(r5.card_x, f1.bottom + 14, "response", "send", "RETURNED",
            "to reportService", "generateReport()'s return value",
            "Cached and persisted by the caller — see REPORT-01 / FLOW-02.",
            w=RW, step="08")
d.flow_down(f0, f1); d.flow_down(f1, f2)
d.handoff(a[-1], b[0], a[-1].right + 14, entry_x=b[0].right - 26)
d.handoff(b[-1], c[0], b[-1].right + 14, entry_x=c[0].right - 26)
d.handoff(c[-1], e[0], c[-1].right + 14, entry_x=e[0].right - 26)
d.handoff(e[0], f0, e[0].right + 14, entry_x=f0.right - 26)

x = band(d, [
    ("E1", "Habit Data Reaches Health", "reportGenerator → healthAnalyzer",
     "The generator passes the monthly habit report as `habits`; health scoring and "
     "signals use that data."),
    ("E2", "One Analyzer Failure Aborts Everything", "no per-analyzer try/catch",
     "generateReport has no isolation between analyzers — any thrown error fails the "
     "whole report, including sections that already succeeded."),
    ("E3", "Summary Includes Health Values", "reportGenerator summary",
     "summary.healthScore and summary.riskLevel are populated from the health report."),
    ("E4", "Legacy Duplicate Config", "analyzers/config/scoringRules.js",
     "A second, differently-weighted rules file — required by nothing. The live "
     "weights are analyzers/scores/healthRules.js."),
    ("E5", "No Query-level Time Bound Beyond a Year", "getPreviousYearExpenses",
     "Only two years are ever loaded; a habit or trend claim about longer history is "
     "not possible from this context."),
    ("E6", "Year-boundary Windows Need Both Years", "pooled current+previous",
     "Deliberately pools two years before filtering today/week/quarter windows, so "
     "early-January comparisons don't manufacture a false spike — recorded as a fix, "
     "not a defect."),
])
refs(d, [(pt, rail, gi, x[i], enter) for i, (pt, rail, gi, enter) in enumerate([
    ((e[1].right, e[1].cy), 1146, 0, "top"),
    ((e[2].cx, e[2].bottom), e[2].cx, 1, "top"),
    ((f1.right, f1.cy), 1584, 2, "top"),
    ((a[1].right, a[1].cy), 852, 3, "left"),
    ((a[1].right, a[1].cy), 866, 4, "top-offset"),
    ((b[1].right, b[1].cy), 1146, 5, "top"),
])])
finish(d, "report-flow-01-analytics-engine-detailed.svg", "FLOW-01",
       "The engine has no HTTP boundary of its own — it is invoked only from a cache "
       "miss (REPORT-01) or a mutation-triggered refresh (FLOW-02).")


# ===========================================================================
# FLOW-02 — mutation-triggered refresh
# ===========================================================================
d, (r1, r2, r3, r4, r5) = base(
    "Mutation-triggered Report refresh — detailed workflow",
    "Level 2 · real functions and call order · badges map to the 9 stages in "
    "report-flow-02-mutation-refresh-overview.svg",
    [(20, 272, "Mutation Commit", "Already documented in Expense/Budget", "database"),
     (306, 272, "Synchronization", "Confirm then refresh", "backend"),
     (592, 272, "Durable Freshness", "PendingSync revision fence", "database"),
     (878, 272, "Full Recompute", "Same engine as FLOW-01", "insights"),
     (1164, 496, "Cache Write & Response Boundary", "The response waits for all of it", "response")])

a = stack(d, r1, [
    ("database", "save", "RESERVATION", "Derived Work Reserved", "PendingSync.reserve()",
     "Pre-write evidence covers report synchronization.", {"step": "01"}),
    ("database", "save", "MUTATION", "Primary Write Commits", "expense, income, or budget",
     "After this point the reservation is never abandoned as though the write failed.", {"step": "02"}),
    ("database", "gears", "PROPAGATION", "Budget + Own Cache", "as applicable",
     "Expense, Income, and Budget controllers share the synchronization lifecycle.", {"step": "02", "tag": "E5"}),
])
b = stack(d, r2, [
    ("backend", "refresh", "CALL", "synchronizeAfterMutation()", "awaited",
     "Confirms pending work, then attempts the revision-fenced refresh.",
     {"step": "03", "tag": "E1"}),
])
c = stack(d, r3, [
    ("database", "bolt", "PENDING SYNC", "Revision Confirmed", "PendingSync.confirm()",
     "The revision becomes the durable minimum freshness floor.", {"step": "04"}),
])
e = stack(d, r4, [
    ("insights", "chart", "ENGINE", "generateReport()", "identical to FLOW-01",
     "No shortcuts — every analyzer and score recomputes.", {"step": "05"}),
    ("database", "save", "MONGODB", "Fenced Persist", "findOneAndUpdate",
     "A superseded revision cannot overwrite a newer report.", {"step": "06", "tag": "E2"}),
])
grp = d.pill_group(r4.card_x, e[-1].bottom + 6, CW, "atomic ordering",
                   [("Mongo fence", "older writes are skipped"),
                    ("Redis CAS", "never overwrite newer cache")])
d.path([(e[-1].cx, e[-1].bottom), (e[-1].cx, grp.y)], "database")
d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)

f0, g, h = region5(
    d, e[-1],
    ("database", "database", "CACHE WRITE", "reportCache.set", "EX 3600",
     "Revision-aware CAS preserves newer cached data.", {"step": "07"}),
    "Then, only now", [
        ("response", "send", "RESPONSE", "Mutation Responds", "201 / 200 OK",
         "The original request finally returns.", {"step": "08", "tag": "E3"}),
        ("frontend", "key", "CLIENT", "Report Invalidated", "queryKeys.reports.all",
         "Part of the mutation's own 4-key invalidation.", {"step": "09"}),
    ],
    "If derived synchronization fails", [
        ("error", "alert", "PENDING", "Write Is Already Durable", "PendingSync marker",
         "The next report read retries recovery instead of serving unproven data.", {"tag": "E4"}),
        ("error", "gauge", "REPAIR ON READ", "Freshness Is Rechecked", "report controller",
         "A failed forced refresh returns controlled 503, never known-stale data.", {}),
    ],
    ("Synchronous, not background", [
        "Nothing here is queued or backgrounded. Synchronization is attempted in the "
        "mutation request, with durable repair-on-read if it cannot complete.",
        "The shared lifecycle is used by Expense, Income, and Budget mutations.",
    ], "error"))

x = band(d, [
    ("E1", "Refresh Is Synchronous", "await synchronizeAfterMutation",
     "The mutation attempts derived-data synchronization in its request; a pending marker "
     "preserves work that needs repair."),
    ("E2", "Concurrent Writes Are Revision-Fenced", "Mongo conditional update + Redis CAS",
     "An older refresh is skipped rather than overwriting a newer Mongo or Redis result."),
    ("E3", "Committed Writes May Need Repair", "post-write synchronization",
     "A derived-data failure is recorded for read-time repair; it is not treated as a fresh report."),
    ("E4", "Known-Stale Reports Are Not Served", "controller forced refresh",
     "If repair remains pending and forced regeneration fails or is superseded, GET /report returns 503."),
    ("E5", "Income Synchronizes the Report", "Income controllers",
     "Add, edit, and delete reserve report work and use the same synchronization lifecycle."),
])
refs(d, [(pt, rail, gi, x[i], enter) for i, (pt, rail, gi, enter) in enumerate([
    ((b[0].right, b[0].cy), 580, 0, "left"),
    ((e[1].right, e[1].cy), 1146, 1, "top"),
    ((h[0].right, h[0].cy), 1584, 2, "top"),
    ((h[1].right, h[1].cy), 1598, 3, "top"),
    ((a[2].cx, a[2].bottom), a[2].cx, 4, "top"),
])])
finish(d, "report-flow-02-mutation-refresh-detailed.svg", "FLOW-02",
       "Synchronization is attempted synchronously; unfinished report work remains "
       "durable and is repaired on a later report read.")
