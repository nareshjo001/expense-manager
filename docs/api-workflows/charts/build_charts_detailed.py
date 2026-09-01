"""
Level 2 detailed diagrams for the whole charts module — one file, ten outputs.

All nine routes share a mount, a middleware pair and an axios client, so the region
skeleton is built once in `base()`. Every card string is traced to source. The two pie
routes are the only ones with a Redis layer; the other seven show that absence
explicitly rather than omitting the region.

Run:  python3 build_charts_detailed.py
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

TOKEN_CARD = ("auth", "key", "AXIOS", "Token Attached", "api.interceptors.request",
              "Adds Authorization: Bearer <token> from localStorage.")
LIMITER_CARD = ("auth", "gauge", "MIDDLEWARE", "Rate Limiter", "apiLimiter",
                "150 req / 15 min. Runs before the router, so keyed by IP.")
VERIFY_CARD = ("auth", "shield", "MIDDLEWARE", "Token Validation", "verifyToken()",
               "jwt.verify + payload check; sets req.userId.")
USER_CARD = ("backend", "user-check", "MONGODB", "User Validation",
             "UserModel.findById(req.userId)",
             "401 when the user record no longer exists.")

FOOT = ("Heavy arrows are region hand-offs; the cyan one is the HTTP response. Light arrows "
        "are steps inside a region. Chart rendering is frontend work and never appears in "
        "the backend regions.")


def base(title, subtitle, r4_label, r4_sub, r5_label, r5_sub):
    d = Diagram(T, title=title, subtitle=subtitle)
    r1 = d.region(20, 272, "Chart Page & Controls", "Route, filters, selectors",
                  accent="ui", step=1)
    r2 = d.region(306, 272, "Frontend Data Layer", "TanStack Query + axios client",
                  accent="frontend", step=2)
    r3 = d.region(592, 272, "API & Security", "Express middleware + controller",
                  accent="backend", step=3)
    r4 = d.region(878, 272, r4_label, r4_sub, accent="database", step=4)
    r5 = d.region(1164, 496, r5_label, r5_sub, accent="insights", step=5)
    return d, (r1, r2, r3, r4, r5)


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


def no_cache_note(d, region, y, h=126):
    return d.note_box(region.card_x, y, CW, h, "No server cache on this route", [
        "This controller never calls getCache or setCache — no key, no TTL, no branch.",
        "Only the two pie routes cache. Every other chart request reaches MongoDB.",
    ], "database")


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
    folders = {"charts-api-01": "trend", "charts-api-02": "trend", "charts-api-03": "trend", "charts-api-04": "trend", "charts-api-05": "trend", "charts-api-06": "bar", "charts-api-07": "bar", "charts-api-08": "pie", "charts-api-09": "pie", "charts-flow-01": "flow"}
    folder = next(value for key, value in folders.items() if out.startswith(key))
    open(os.path.join(HERE, folder, out), "w", encoding="utf-8").write(svg)
    print("wrote", out, len(svg))


# ===========================================================================
def plain_chart(api_id, out, title, stages_note, r1_cards, r2_cards, r3_cards,
                r4_cards, r5_span, r5_left, r5_right, right_note, band_cards,
                ref_spec, tail, r4_label="Database & Cache",
                r4_sub="MongoDB only — no Redis on this route",
                r5_label="Chart Transformation & Rendering",
                r5_sub="Client cache, series prep, visual"):
    d, (r1, r2, r3, r4, r5) = base(
        title,
        "Level 2 · real functions, middleware and models · badges map to the "
        "%s in %s" % (stages_note, out.replace("-detailed.svg", "-overview.svg")),
        r4_label, r4_sub, r5_label, r5_sub)
    a = stack(d, r1, r1_cards)
    b = stack(d, r2, r2_cards)
    c = stack(d, r3, r3_cards)
    e = stack(d, r4, r4_cards)
    d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e[0], 871)
    no_cache_note(d, r4, e[-1].bottom + 20)

    f0 = d.card(1180, Y0, *r5_span[:6], w=464, **r5_span[6])
    d.handoff(e[-1], f0, 1157, kind="response", width=T["stroke"]["responsePath"],
              label="HTTP RESPONSE")
    rh = 104 + len(r5_right) * PITCH
    d.sub_region(SUB_L, 232, SUB_W, 104 + len(r5_left) * PITCH, "Chart series", "insights")
    d.sub_region(SUB_R, 232, SUB_W, rh, "Shared consumer", "ui")
    LY = 264
    g = [d.card(1180, LY + i * PITCH, *sp[:6], **sp[6]) for i, sp in enumerate(r5_left)]
    for p, q in zip(g, g[1:]):
        d.flow_down(p, q)
    h = [d.card(1420, LY + i * PITCH, *sp[:6], **sp[6]) for i, sp in enumerate(r5_right)]
    for p, q in zip(h, h[1:]):
        d.flow_down(p, q)
    d.path([(g[0].right - 30, f0.bottom), (g[0].right - 30, g[0].y)], "insights",
           width=T["stroke"]["primaryPath"])
    d.path([(h[0].right - 30, f0.bottom), (h[0].right - 30, h[0].y)], "ui",
           width=T["stroke"]["primaryPath"])
    d.note_box(1420, 232 + rh + 16, 224, 190, *right_note)

    x = band(d, band_cards)
    refs(d, [(pt, rail, gi, x[i], enter)
             for i, (pt, rail, gi, enter) in enumerate(ref_spec(a, b, c, e, f0, g, h))])
    finish(d, out, api_id, tail)


COMMON_BAND = [
    ("E1", "429 Too Many Requests", "apiLimiter",
     "More than 150 requests in 15 minutes from the same IP address."),
    ("E2", "401 Unauthorized", "verifyToken()",
     "Missing Bearer header, malformed payload, or expired JWT. The axios interceptor "
     "then calls forceReauth()."),
    ("E3", "401 User does not exist", "UserModel.findById → null",
     "Checked before any chart data is read."),
]

STD_REFS = lambda a, b, c, e, f0, g, h: [
    ((c[0].right, c[0].cy), 852, 0, "left"),
    ((c[2].x, c[2].cy), 604, 1, "top-offset"),
    ((e[0].x, e[0].cy), 890, 2, "top"),
    ((c[-1].cx, c[-1].bottom), c[-1].cx, 3, "top"),
    ((e[-2].right, e[-2].cy), 1132, 4, "top"),
    ((g[-1].right, g[-1].cy), 1412, 5, "top"),
]


# === CHARTS-01 =============================================================
plain_chart(
    "CHARTS-01", "charts-api-01-logged-years-detailed.svg",
    "GET /chart/getloggedyears — detailed implementation workflow", "9 stages",
    [("ui", "window", "ROUTE", "Chart Route", "LandingPage.js · /chart/line",
      "TrendChartPage is the only mount for this query.", {"step": "01"}),
     ("ui", "layout", "COMPONENT", "Trend Chart Page", "TrendChartPage.js",
      "Calls the years query unconditionally on mount.", {"step": "01"})],
    [("frontend", "refresh", "TANSTACK", "Years Query", "useLoggedYearsQuery()",
      "No arguments and no enabled flag — always runs.", {"step": "02"}),
     ("frontend", "key", "CACHE KEY", "Query Key", "queryKeys.charts.loggedYears()",
      "[\"charts\",\"logged-years\"] — independent of every filter.", {"step": "02"}),
     ("frontend", "send", "API CLIENT", "Request Function", "getLoggedYears(signal)",
      "GET /chart/getloggedyears; aborts on unmount.", {"step": "03"}),
     TOKEN_CARD + ({"step": "03"},)],
    [LIMITER_CARD + ({"step": "04", "tag": "E1"},),
     ("backend", "server", "ROUTER", "Route Match", "chart.routes.js",
      "GET /getloggedyears → verifyToken → getloggedyears.", {"step": "04"}),
     VERIFY_CARD + ({"step": "04", "tag": "E2"},),
     ("backend", "gears", "CONTROLLER", "Request Handler", "getloggedyears()",
      "One try/catch around the user check and the aggregation.",
      {"step": "05", "tag": "E5"})],
    [USER_CARD + ({"step": "05", "tag": "E3"},),
     ("database", "database", "MONGODB · AGGREGATE", "Distinct Years",
      "$group { _id: $year }",
      "The only chart route that aggregates in MongoDB, not in Node.",
      {"step": "06", "tag": "E4"}),
     ("response", "send", "RESPONSE", "200 OK", "res.status(200).json({ … })",
      "{ success, data } — data is a bare array of numbers.", {"step": "07"})],
    ("frontend", "refresh", "TANSTACK · CLIENT CACHE", "Query Cache",
     "queryClient (defaultOptions)",
     "staleTime 5 min · gcTime 30 min · retry 1 · no focus refetch.", {"step": "08"}),
    [("frontend", "sigma", "DERIVED", "Available Years", "loggedYearsQuery.data.data",
      "Falls back to [] whenever success is not true.", {"step": "09"}),
     ("ui", "cursor", "UI", "Year Picker", "react-select (isMulti)",
      "Populates the multi-year comparison selector.", {"step": "09"})],
    [("ui", "chart", "FEEDS", "Not a Chart", "TrendChartPage",
      "This response drives a control; it is never plotted.", {"step": "09"})],
    ("The only MongoDB aggregation", [
        "Every other chart route pulls documents and groups them in Node.",
        "$year here is evaluated in UTC, while every JavaScript range in this module "
        "is built in server local time.",
    ], "database"),
    COMMON_BAND + [
        ("E4", "UTC vs local year boundary", "$year: \"$expenseDate\"",
         "MongoDB evaluates $year in UTC while every range resolver in this module "
         "uses server local time, so a 31 December expense can land in a different "
         "year on the two paths."),
        ("E5", "500 Internal Server Error", "catch (err)",
         "An aggregation failure surfaces here with a generic body."),
        ("E6", "Empty picker on failure", "TrendChartPage.js",
         "availableYears falls back to [], so the selector renders empty with no "
         "message — indistinguishable from an account with no expenses."),
    ],
    lambda a, b, c, e, f0, g, h: [
        ((c[0].right, c[0].cy), 852, 0, "left"),
        ((c[2].x, c[2].cy), 604, 1, "top-offset"),
        ((e[0].x, e[0].cy), 890, 2, "top"),
        ((e[1].right, e[1].cy), 1132, 3, "top"),
        ((c[3].cx, c[3].bottom), c[3].cx, 4, "top"),
        ((g[0].right, g[0].cy), 1412, 5, "top"),
    ],
    "This is the only chart endpoint whose response never reaches a visualisation — it "
    "populates the year selector that CHARTS-05 depends on.")


# === CHARTS-02 =============================================================
plain_chart(
    "CHARTS-02", "charts-api-02-trend-by-week-detailed.svg",
    "GET /chart/linechartbyweek — detailed implementation workflow", "10 stages",
    [("ui", "window", "ROUTE", "Chart Route", "LandingPage.js · /chart/line",
      "TrendChartPage mounts with an empty viewBy.", {"step": "01"}),
     ("ui", "cursor", "STATE", "View By Week", "viewBy === 'week'",
      "Reveals a month input; nothing fetches until it has a value.", {"step": "01"}),
     ("ui", "cursor", "INPUT", "Month Picker", "selectedMonthYear",
      "A native month input yields the string YYYY-MM.", {"step": "01"})],
    [("frontend", "refresh", "TANSTACK", "Trend Query", "useTrendChartQuery(…)",
      "resolveTrendChartMode splits the string into year and month.",
      {"step": "02"}),
     ("frontend", "key", "CACHE KEY", "Query Key", "queryKeys.charts.trend(…)",
      "{mode:\"week\",selectedMonthYear} — one entry per month.", {"step": "02"}),
     ("frontend", "send", "API CLIENT", "Request Function", "getTrendChartByWeek(y, m)",
      "Both values travel as query parameters.", {"step": "03"}),
     TOKEN_CARD + ({"step": "03"},)],
    [LIMITER_CARD + ({"step": "04", "tag": "E1"},),
     ("backend", "server", "ROUTER", "Route Match", "chart.routes.js",
      "GET /linechartbyweek → verifyToken → linechartbyweek.", {"step": "04"}),
     VERIFY_CARD + ({"step": "04", "tag": "E2"},),
     ("backend", "gears", "CONTROLLER", "Request Handler", "linechartbyweek()",
      "One try/catch around the guard and the service call.",
      {"step": "05", "tag": "E5"})],
    [USER_CARD + ({"step": "05", "tag": "E3"},),
     ("auth", "gauge", "GUARD", "Param Guard", "if (!year || !month)",
      "Presence only — neither value is checked for being numeric.",
      {"step": "06", "tag": "E4"}),
     ("database", "database", "MONGODB · PRIMARY DATA", "Month Read",
      "resolveMonthRange(y, m)",
      "One inclusive range, built in server local time.", {"step": "07"}),
     ("backend", "layers", "TRANSFORM", "Week Bucketing", "bucketByWeek(…)",
      "Monday-start weeks, then relabelled Week 1..N in order.",
      {"step": "08", "tag": "E6"}),
     ("response", "send", "RESPONSE", "200 OK", "res.status(200).json({ … })",
      "{ success, data } — [{ week, total }] only for weeks with spend.",
      {"step": "09"})],
    ("frontend", "refresh", "TANSTACK · CLIENT CACHE", "Query Cache",
     "queryClient (defaultOptions)",
     "staleTime 5 min · gcTime 30 min · retry 1 · no focus refetch.", {"step": "09"}),
    [("insights", "sigma", "DERIVED", "Series Array", "trendChartQuery.data.data",
      "Falls back to [] unless success is true and data is an array.",
      {"step": "10"}),
     ("insights", "chart", "DERIVED", "Average Line", "reduce / data.length",
      "A page-level average computed from the same array.", {"step": "10"}),
     ("ui", "chart", "UI", "Line Chart", "<TrendChartWrapper/>",
      "week is the x-axis key; total is the series.", {"step": "10"})],
    [("insights", "send", "FAN-OUT", "Insight Trigger", "notifyChartFilterApplied",
      "The same array is also handed to the chart insights flow.", {"step": "10"})],
    ("One response, two consumers", [
        "The chart and the insight card read the identical cached array.",
        "Neither copies or mutates it; see charts-flow-01 for the insight path.",
    ], "insights"),
    COMMON_BAND + [
        ("E4", "Params are not type-checked", "if (!selectedYear || !selectedMonth)",
         "Only presence is verified. Non-numeric values reach resolveMonthRange and "
         "produce an Invalid Date range."),
        ("E5", "500 Internal Server Error", "catch (err)",
         "A read failure or an invalid date range surfaces here with a generic body."),
        ("E6", "Week labels are positional", "bucketByWeek labelType weekNumber",
         "Only weeks containing spend survive, and they are renumbered from 1 — so "
         "“Week 2” can be the fourth calendar week of the month."),
    ],
    STD_REFS,
    "Bucketing happens in backend JavaScript, not in MongoDB, and empty weeks are "
    "dropped rather than zero-filled.")


# === CHARTS-03 =============================================================
plain_chart(
    "CHARTS-03", "charts-api-03-trend-by-month-detailed.svg",
    "GET /chart/linechartbymonth — detailed implementation workflow", "10 stages",
    [("ui", "window", "ROUTE", "Chart Route", "LandingPage.js · /chart/line",
      "Same page as CHARTS-02 and CHARTS-04.", {"step": "01"}),
     ("ui", "cursor", "STATE", "View By Month", "viewBy === 'bymonth'",
      "Reveals a numeric year input.", {"step": "01"}),
     ("ui", "cursor", "INPUT", "Year Input", "selectedYear.length === 4",
      "The hook waits for exactly four characters before enabling.",
      {"step": "01"})],
    [("frontend", "refresh", "TANSTACK", "Trend Query", "useTrendChartQuery(…)",
      "Mode month; enabled only once the year is four characters.",
      {"step": "02"}),
     ("frontend", "key", "CACHE KEY", "Query Key", "queryKeys.charts.trend(…)",
      "{mode:\"month\",year} — one entry per year.", {"step": "02"}),
     ("frontend", "send", "API CLIENT", "Request Function", "getTrendChartByMonth(y)",
      "selectedYear travels as a query parameter.", {"step": "03"}),
     TOKEN_CARD + ({"step": "03"},)],
    [LIMITER_CARD + ({"step": "04", "tag": "E1"},),
     ("backend", "server", "ROUTER", "Route Match", "chart.routes.js",
      "GET /linechartbymonth → verifyToken → linechartbymonth.", {"step": "04"}),
     VERIFY_CARD + ({"step": "04", "tag": "E2"},),
     ("backend", "gears", "CONTROLLER", "Request Handler", "linechartbymonth()",
      "One try/catch around the guard and the service call.",
      {"step": "05", "tag": "E5"})],
    [USER_CARD + ({"step": "05", "tag": "E3"},),
     ("auth", "gauge", "GUARD", "Year Guard", "Number(…) + isNaN",
      "The only trend route that checks its parameter is numeric.",
      {"step": "06", "tag": "E4"}),
     ("database", "database", "MONGODB · PRIMARY DATA", "Year Read",
      "resolveYearRange → fetchExpense",
      "Jan 1 to Dec 31 inclusive, in server local time.", {"step": "07"}),
     ("backend", "layers", "TRANSFORM", "Monthly Totals", "monthlyTotals(expenses)",
      "Twelve buckets are built, then months totalling 0 are filtered out.",
      {"step": "08", "tag": "E6"}),
     ("response", "send", "RESPONSE", "200 OK", "res.status(200).json({ … })",
      "{ success, data } — [{ month, total }], Jan→Dec order preserved.",
      {"step": "09"})],
    ("frontend", "refresh", "TANSTACK · CLIENT CACHE", "Query Cache",
     "queryClient (defaultOptions)",
     "staleTime 5 min · gcTime 30 min · retry 1 · no focus refetch.", {"step": "09"}),
    [("insights", "sigma", "DERIVED", "Series Array", "trendChartQuery.data.data",
      "Falls back to [] unless success is true and data is an array.",
      {"step": "10"}),
     ("insights", "chart", "DERIVED", "Average Line", "reduce / data.length",
      "Averaged over surviving months only, not over twelve.", {"step": "10"}),
     ("ui", "chart", "UI", "Line Chart", "<TrendChartWrapper/>",
      "month is the x-axis key; total is the series.", {"step": "10"})],
    [("insights", "send", "FAN-OUT", "Insight Trigger", "notifyChartFilterApplied",
      "The same array is also handed to the chart insights flow.", {"step": "10"})],
    ("Month names are safe here", [
        "Labels come from the MONTH_NAMES constant, not from toLocaleString, so they "
        "do not vary with the server locale.",
        "The budget module builds its month keys differently — see budget/README.md.",
    ], "backend"),
    COMMON_BAND + [
        ("E4", "400 Invalid year", "!selectedYear || isNaN(…)",
         "Rejected before any query runs. This is the only trend route with a numeric "
         "check on its parameter."),
        ("E5", "500 Internal Server Error", "catch (err)",
         "A read failure surfaces here with a generic body."),
        ("E6", "Missing months are dropped", "filter(item => item.total > 0)",
         "Months with no spending are removed rather than zero-filled, so the line "
         "jumps between non-adjacent months and the average is computed over a "
         "shorter series than the year."),
    ],
    STD_REFS,
    "Aggregation is backend JavaScript over fetched documents; MongoDB performs only "
    "the range filter.")


# === CHARTS-04 =============================================================
plain_chart(
    "CHARTS-04", "charts-api-04-trend-by-year-detailed.svg",
    "GET /chart/linechartbyyear — detailed implementation workflow", "9 stages",
    [("ui", "window", "ROUTE", "Chart Route", "LandingPage.js · /chart/line",
      "Same page as CHARTS-02 and CHARTS-03.", {"step": "01"}),
     ("ui", "cursor", "STATE", "View By Year", "viewBy === 'byyear'",
      "With compare unchecked, no further input is required.", {"step": "01"})],
    [("frontend", "refresh", "TANSTACK", "Trend Query", "useTrendChartQuery(…)",
      "Mode year; enabled immediately.", {"step": "02"}),
     ("frontend", "key", "CACHE KEY", "Query Key", "queryKeys.charts.trend(…)",
      "{mode:\"year\"} — a single entry, no parameters.", {"step": "02"}),
     ("frontend", "send", "API CLIENT", "Request Function", "getTrendChartByYear()",
      "No query parameters are sent at all.", {"step": "03"}),
     TOKEN_CARD + ({"step": "03"},)],
    [LIMITER_CARD + ({"step": "04", "tag": "E1"},),
     ("backend", "server", "ROUTER", "Route Match", "chart.routes.js",
      "GET /linechartbyyear → verifyToken → linechartbyyear.", {"step": "04"}),
     VERIFY_CARD + ({"step": "04", "tag": "E2"},),
     ("backend", "gears", "CONTROLLER", "Request Handler", "linechartbyyear()",
      "No parameters, so no guard beyond the user check.",
      {"step": "05", "tag": "E5"})],
    [USER_CARD + ({"step": "05", "tag": "E3"},),
     ("database", "database", "MONGODB · PRIMARY DATA", "Full History Read",
      "ExpenseModel.find({ userId })",
      "No date filter and no limit — the entire collection for the user.",
      {"step": "06", "tag": "E4"}),
     ("backend", "layers", "TRANSFORM", "Group By Year", "groupByYear(expenses)",
      "parseISO + getYear per document, then summed per year.",
      {"step": "07", "tag": "E6"}),
     ("response", "send", "RESPONSE", "200 OK", "res.status(200).json({ … })",
      "{ success, data } — [{ year, total }] in first-seen order.",
      {"step": "08"})],
    ("frontend", "refresh", "TANSTACK · CLIENT CACHE", "Query Cache",
     "queryClient (defaultOptions)",
     "staleTime 5 min · gcTime 30 min · retry 1 · no focus refetch.", {"step": "08"}),
    [("insights", "sigma", "DERIVED", "Series Array", "trendChartQuery.data.data",
      "Falls back to [] unless success is true and data is an array.",
      {"step": "09"}),
     ("ui", "chart", "UI", "Line Chart", "<TrendChartWrapper/>",
      "year is the x-axis key; total is the series.", {"step": "09"})],
    [("insights", "send", "FAN-OUT", "Insight Trigger", "notifyChartFilterApplied",
      "The same array is also handed to the chart insights flow.", {"step": "09"})],
    ("Order depends on document order", [
        "groupByYear builds an object keyed by year, then maps its entries.",
        "Integer-like keys happen to come back in ascending order, so the series looks "
        "sorted — but nothing sorts it explicitly.",
    ], "backend"),
    COMMON_BAND + [
        ("E4", "Unbounded read", "ExpenseModel.find({ userId })",
         "No range, no projection and no limit. Response cost and memory grow with the "
         "user's entire history, and this route has no server cache in front of it."),
        ("E5", "500 Internal Server Error", "catch (err)",
         "A read failure surfaces here with a generic body."),
        ("E6", "Ordering is incidental", "Object.entries(yearlyExpenses)",
         "The series is never explicitly sorted; it relies on JavaScript's ordering of "
         "integer-like object keys."),
    ],
    lambda a, b, c, e, f0, g, h: [
        ((c[0].right, c[0].cy), 852, 0, "left"),
        ((c[2].x, c[2].cy), 604, 1, "top-offset"),
        ((e[0].x, e[0].cy), 890, 2, "top"),
        ((e[1].right, e[1].cy), 1132, 3, "top"),
        ((c[3].cx, c[3].bottom), c[3].cx, 4, "top"),
        ((e[2].right, e[2].cy), 1143, 5, "top"),
    ],
    "The only chart route with no date bound: it reads every expense the user owns on "
    "each request, with no cache in front of it.")


# === CHARTS-05 =============================================================
plain_chart(
    "CHARTS-05", "charts-api-05-trend-between-years-detailed.svg",
    "GET /chart/linechartbetweenyears — detailed implementation workflow", "10 stages",
    [("ui", "window", "ROUTE", "Chart Route", "LandingPage.js · /chart/line",
      "Same page; compare-by-year switches the mode.", {"step": "01"}),
     ("ui", "cursor", "STATE", "Compare Enabled", "compareByYear === true",
      "Reveals the multi-year selector.", {"step": "01"}),
     ("ui", "cursor", "INPUT", "Year Multi-Select", "selectedYears[]",
      "Options come from CHARTS-01; the hook waits for at least one.",
      {"step": "01"})],
    [("frontend", "refresh", "TANSTACK", "Trend Query", "useTrendChartQuery(…)",
      "Mode betweenYears; enabled once the array is non-empty.", {"step": "02"}),
     ("frontend", "key", "CACHE KEY", "Query Key", "queryKeys.charts.trend(…)",
      "{mode:\"betweenYears\",years} — the array is part of the key.",
      {"step": "02"}),
     ("frontend", "send", "API CLIENT", "Request Function", "getTrendChartBetweenYears",
      "The array is joined into a comma-separated string.", {"step": "03"}),
     TOKEN_CARD + ({"step": "03"},)],
    [LIMITER_CARD + ({"step": "04", "tag": "E1"},),
     ("backend", "server", "ROUTER", "Route Match", "chart.routes.js",
      "GET /linechartbetweenyears → verifyToken → linechartbetweenyears.",
      {"step": "04"}),
     VERIFY_CARD + ({"step": "04", "tag": "E2"},),
     ("backend", "gears", "CONTROLLER", "Request Handler", "linechartbetweenyears()",
      "One try/catch around both guards and the service call.",
      {"step": "05", "tag": "E5"})],
    [USER_CARD + ({"step": "05", "tag": "E3"},),
     ("auth", "gauge", "GUARD", "Years Guard", "split(',') + some(isNaN)",
      "400 when absent, and again when any entry is not numeric.",
      {"step": "06", "tag": "E4"}),
     ("database", "database", "MONGODB · PRIMARY DATA", "Span Read",
      "resolveMultiYearRange(years)",
      "One range from the lowest Jan 1 to the highest Dec 31.", {"step": "07"}),
     ("backend", "layers", "TRANSFORM", "Month × Year Grid", "getMultiYearLineChart",
      "Twelve rows keyed by year, then all-zero rows removed.",
      {"step": "08", "tag": "E6"}),
     ("response", "send", "RESPONSE", "200 OK", "res.status(200).json({ … })",
      "{ success, data } — [{ month, <year>: total, … }] rows.", {"step": "09"})],
    ("frontend", "refresh", "TANSTACK · CLIENT CACHE", "Query Cache",
     "queryClient (defaultOptions)",
     "staleTime 5 min · gcTime 30 min · retry 1 · no focus refetch.", {"step": "09"}),
    [("insights", "sigma", "DERIVED", "Series Array", "trendChartQuery.data.data",
      "Falls back to [] unless success is true and data is an array.",
      {"step": "10"}),
     ("ui", "chart", "UI", "Multi Line Chart", "<MultiTrendChartWrapper/>",
      "One line per selected year, keyed by the year number.", {"step": "10"})],
    [("insights", "send", "NOT SENT", "Insight Skipped", "compareByYear === true",
      "The insights flow is deliberately bypassed in compare mode.",
      {"step": "10"})],
    ("Zeros survive selectively", [
        "A row is removed only when every selected year is zero for that month.",
        "A month kept for one year still carries an explicit 0 for the others, which "
        "the chart plots as a real point.",
    ], "backend"),
    COMMON_BAND + [
        ("E4", "400 Invalid year list", "!yearsParam / years.some(isNaN)",
         "Rejected when the parameter is absent, and again when any comma-separated "
         "entry is not a number."),
        ("E5", "500 Internal Server Error", "catch (err)",
         "A read failure surfaces here with a generic body."),
        ("E6", "Partial rows keep zeros", "grid.filter(… some(val > 0))",
         "Only all-zero months are dropped. A month present for one year plots an "
         "explicit zero for every other selected year."),
    ],
    STD_REFS,
    "The backend builds the whole month × year grid; the frontend plots it as-is and "
    "performs no join of its own.")


# === CHARTS-06 =============================================================
plain_chart(
    "CHARTS-06", "charts-api-06-bar-by-category-detailed.svg",
    "GET /chart/barchartbycategory — detailed implementation workflow", "10 stages",
    [("ui", "window", "ROUTE", "Chart Route", "LandingPage.js · /chart/bar",
      "BarChartPage mounts with an empty viewBy.", {"step": "01"}),
     ("ui", "cursor", "STATE", "View By Category", "viewBy === 'bycategory'",
      "Shows a checkbox offering a specific month.", {"step": "01"}),
     ("ui", "cursor", "INPUT", "Optional Month", "specificMonth + month",
      "When unchecked no month is sent and the year is used.", {"step": "01"})],
    [("frontend", "refresh", "TANSTACK", "Bar Query", "useBarChartQuery(…)",
      "Two category branches: with and without a month.", {"step": "02"}),
     ("frontend", "key", "CACHE KEY", "Query Key", "queryKeys.charts.bar(…)",
      "{mode:\"category\"} or {mode:\"category\",month}.", {"step": "02"}),
     ("frontend", "send", "API CLIENT", "Request Function", "getBarChartByCategory(m)",
      "params is omitted entirely when no month is chosen.", {"step": "03"}),
     TOKEN_CARD + ({"step": "03"},)],
    [LIMITER_CARD + ({"step": "04", "tag": "E1"},),
     ("backend", "server", "ROUTER", "Route Match", "chart.routes.js",
      "GET /barchartbycategory → verifyToken → barchartbycategory.",
      {"step": "04"}),
     VERIFY_CARD + ({"step": "04", "tag": "E2"},),
     ("backend", "gears", "CONTROLLER", "Request Handler", "barchartbycategory()",
      "One try/catch around range resolution and the read.",
      {"step": "05", "tag": "E5"})],
    [USER_CARD + ({"step": "05", "tag": "E3"},),
     ("backend", "gauge", "RESOLVE", "Range Resolution", "resolveMonthRange / Year",
      "Splits YYYY-MM with no validation, else the current year.",
      {"step": "06", "tag": "E4"}),
     ("database", "database", "MONGODB · PRIMARY DATA", "Range Read",
      "getCategoryBreakdown(…)",
      "Shared with CHARTS-08; only the range and type differ.", {"step": "07"}),
     ("backend", "layers", "TRANSFORM", "Category Totals", "categoryTotals(grouped)",
      "Group by expenseCategory, then sum. Never sorted.",
      {"step": "08", "tag": "E6"}),
     ("response", "send", "RESPONSE", "200 OK", "res.status(200).json({ … })",
      "{ success, data } — [{ category, total }].", {"step": "09"})],
    ("frontend", "refresh", "TANSTACK · CLIENT CACHE", "Query Cache",
     "queryClient (defaultOptions)",
     "staleTime 5 min · gcTime 30 min · retry 1 · no focus refetch.", {"step": "09"}),
    [("insights", "sigma", "DERIVED", "Series Array", "barChartQuery.data.data",
      "Falls back to [] unless success is true and data is an array.",
      {"step": "10"}),
     ("ui", "chart", "UI", "Bar Chart", "<BarChartWrapper/>",
      "xKey category, barKey total, single series.", {"step": "10"})],
    [("insights", "send", "FAN-OUT", "Insight Trigger", "notifyChartFilterApplied",
      "The same array is also handed to the chart insights flow.", {"step": "10"})],
    ("Shared service, two callers", [
        "getCategoryBreakdown backs both this route and CHARTS-08.",
        "This route always asks for totals; the pie route can also ask for counts.",
    ], "backend"),
    COMMON_BAND + [
        ("E4", "month is never validated", "month.split('-').map(Number)",
         "A value like abc yields NaN, and new Date(NaN, …) produces an Invalid Date "
         "range that fails at query time as a 500 rather than a 400."),
        ("E5", "500 Internal Server Error", "catch (err)",
         "An invalid range or a read failure surfaces here with a generic body."),
        ("E6", "Bar order is not defined", "Object.entries(grouped)",
         "Categories arrive in insertion order and are never sorted, so bar order can "
         "differ between two requests over the same range."),
    ],
    STD_REFS,
    "Grouping happens in backend JavaScript; MongoDB performs only the range filter.")


# === CHARTS-07 =============================================================
plain_chart(
    "CHARTS-07", "charts-api-07-bar-budget-vs-spend-detailed.svg",
    "GET /chart/barchartbymonth — detailed implementation workflow", "10 stages",
    [("ui", "window", "ROUTE", "Chart Route", "LandingPage.js · /chart/bar",
      "Same page as CHARTS-06.", {"step": "01"}),
     ("ui", "cursor", "STATE", "View By Month", "viewBy === 'bymonth'",
      "Reveals a numeric year input.", {"step": "01"}),
     ("ui", "cursor", "INPUT", "Year Input", "selectedYear.length === 4",
      "The hook waits for exactly four characters before enabling.",
      {"step": "01"})],
    [("frontend", "refresh", "TANSTACK", "Bar Query", "useBarChartQuery(…)",
      "Mode month; enabled once the year is four characters.", {"step": "02"}),
     ("frontend", "key", "CACHE KEY", "Query Key", "queryKeys.charts.bar(…)",
      "{mode:\"month\",year} — one entry per year.", {"step": "02"}),
     ("frontend", "send", "API CLIENT", "Request Function", "getBarChartByMonth(y)",
      "year travels as a query parameter.", {"step": "03"}),
     TOKEN_CARD + ({"step": "03"},)],
    [LIMITER_CARD + ({"step": "04", "tag": "E1"},),
     ("backend", "server", "ROUTER", "Route Match", "chart.routes.js",
      "GET /barchartbymonth → verifyToken → barchartbymonth.", {"step": "04"}),
     VERIFY_CARD + ({"step": "04", "tag": "E2"},),
     ("backend", "gears", "CONTROLLER", "Request Handler", "barchartbymonth()",
      "One try/catch around the guard, the read and the mapping.",
      {"step": "05", "tag": "E5"})],
    [USER_CARD + ({"step": "05", "tag": "E3"},),
     ("auth", "gauge", "GUARD", "Year Guard", "if (!selectedYear)",
      "Presence only — the raw string is used unmodified.",
      {"step": "06", "tag": "E4"}),
     ("database", "database", "MONGODB · BUDGET DATA", "Budget Read",
      "BudgetModel.find({ month })",
      "The only chart route that reads budgets instead of expenses.",
      {"step": "07"}),
     ("backend", "layers", "TRANSFORM", "Map and Sort", "MONTH_ORDER.indexOf",
      "Splits the \"Mon YYYY\" key, then orders Jan→Dec.",
      {"step": "08", "tag": "E6"}),
     ("response", "send", "RESPONSE", "200 OK", "res.status(200).json({ … })",
      "{ success, data } — [{ month, budget, total }].", {"step": "09"})],
    ("frontend", "refresh", "TANSTACK · CLIENT CACHE", "Query Cache",
     "queryClient (defaultOptions)",
     "staleTime 5 min · gcTime 30 min · retry 1 · no focus refetch.", {"step": "09"}),
    [("insights", "sigma", "DERIVED", "Series Array", "barChartQuery.data.data",
      "Falls back to [] unless success is true and data is an array.",
      {"step": "10"}),
     ("ui", "chart", "UI", "Double Bar Chart", "<BarChartWrapper/>",
      "barKey total plus secondBarKey budget, side by side.", {"step": "10"})],
    [("insights", "send", "FAN-OUT", "Insight Trigger", "notifyChartFilterApplied",
      "The same array is also handed to the chart insights flow.", {"step": "10"})],
    ("Not a join — one collection", [
        "budget and spent both live on the same budget document, written by the "
        "budget module.",
        "Neither the backend nor the frontend joins expenses into this response.",
    ], "database"),
    COMMON_BAND + [
        ("E4", "Year is interpolated into a RegExp", "new RegExp(year + '$', 'i')",
         "Only presence is checked, so the raw query string becomes a pattern. A value "
         "of .* matches every stored month key and returns budgets from all years."),
        ("E5", "500 Internal Server Error", "catch (err)",
         "A read or mapping failure surfaces here with a generic body."),
        ("E6", "Month labels rely on English keys", "MONTH_ORDER.indexOf(month)",
         "Sorting resolves the abbreviation against an English constant. A month key "
         "written under a non-English server locale yields -1 and sorts first."),
    ],
    STD_REFS,
    "This route consumes budget data written by BUDGET-02 and BUDGET-03; it does not "
    "call those endpoints. See budget/README.md.",
    r4_label="Database & Cache", r4_sub="BudgetModel only — no expense query, no Redis")


# === CHARTS-08 / CHARTS-09: the two cached pie routes =====================
def cached_pie(api_id, out, title, stages, r1_cards, r2_cards, r3_cards, cache_card,
               miss_cards, r5_left, r5_right, right_note, band_cards, tail, chips):
    d, (r1, r2, r3, r4, r5) = base(
        title,
        "Level 2 · real functions, middleware and models · badges map to the "
        "%s in %s" % (stages, out.replace("-detailed.svg", "-overview.svg")),
        "Database & Cache", "Redis short-circuit → MongoDB",
        "Chart Transformation & Rendering", "Client cache, series prep, visual")
    a = stack(d, r1, r1_cards)
    b = stack(d, r2, r2_cards)
    c = stack(d, r3, r3_cards)

    e0 = d.card(r4.card_x, Y0, *cache_card[:6], h=112, **cache_card[6])
    rest = []
    y = e0.bottom + 14
    for sp in miss_cards:
        card = d.card(r4.card_x, y, *sp[:6], **sp[6])
        rest.append(card)
        y = card.bottom + 14
    d.flow_down(e0, rest[0])
    for p, q in zip(rest, rest[1:]):
        d.flow_down(p, q)
    grp = d.pill_group(r4.card_x, rest[-1].bottom + 6, CW, chips[0], chips[1])
    d.path([(rest[-1].cx, rest[-1].bottom), (rest[-1].cx, grp.y)], "database")

    d.handoff(a[-1], b[0], 299); d.handoff(b[-1], c[0], 585); d.handoff(c[-1], e0, 871)

    HIT = 1132
    d.path([(e0.right, e0.y + 100), (HIT, e0.y + 100), (HIT, grp.bottom + 6),
            (rest[-1].cx + 66, grp.bottom + 6), (rest[-1].cx + 66, rest[-1].bottom)],
           "database", width=T["stroke"]["branchPath"],
           label="CACHE HIT", label_at=(HIT, 520), label_rotate=True)

    f0 = d.card(1180, Y0, "frontend", "refresh", "TANSTACK · CLIENT CACHE",
                "Query Cache", "queryClient (defaultOptions)",
                "staleTime 5 min · gcTime 30 min · retry 1 · no focus refetch.",
                w=464, step=r5_left[0][6]["step"])
    d.handoff(rest[-1], f0, 1157, kind="response", width=T["stroke"]["responsePath"],
              label="HTTP RESPONSE")
    rh = 104 + len(r5_right) * PITCH
    d.sub_region(SUB_L, 232, SUB_W, 104 + len(r5_left) * PITCH, "Chart series", "insights")
    d.sub_region(SUB_R, 232, SUB_W, rh, "Shared consumer", "ui")
    LY = 264
    g = [d.card(1180, LY + i * PITCH, *sp[:6], **sp[6]) for i, sp in enumerate(r5_left)]
    for p, q in zip(g, g[1:]):
        d.flow_down(p, q)
    h = [d.card(1420, LY + i * PITCH, *sp[:6], **sp[6]) for i, sp in enumerate(r5_right)]
    d.path([(g[0].right - 30, f0.bottom), (g[0].right - 30, g[0].y)], "insights",
           width=T["stroke"]["primaryPath"])
    d.path([(h[0].right - 30, f0.bottom), (h[0].right - 30, h[0].y)], "ui",
           width=T["stroke"]["primaryPath"])
    d.note_box(1420, 232 + rh + 16, 224, 190, *right_note)

    x = band(d, band_cards)
    refs(d, [((c[0].right, c[0].cy), 852, 0, x[0], "left"),
             ((c[2].x, c[2].cy), 604, 1, x[1], "top-offset"),
             ((rest[0].x, rest[0].cy), 890, 2, x[2], "top"),
             ((e0.right, e0.y + 32), 1143, 3, x[3], "top"),
             ((c[3].cx, c[3].bottom), c[3].cx, 4, x[4], "top"),
             ((g[-1].right, g[-1].cy), 1412, 5, x[5], "top")])
    finish(d, out, api_id, tail)


cached_pie(
    "CHARTS-08", "charts-api-08-pie-category-detailed.svg",
    "GET /chart/getPieCategoryData — detailed implementation workflow", "11 stages",
    [("ui", "window", "ROUTE", "Chart Route", "LandingPage.js · /chart/pie",
      "PieChartPage mounts with show empty.", {"step": "01"}),
     ("ui", "cursor", "STATE", "Show Mode", "distribution | count",
      "Chooses type=total or type=count.", {"step": "01"}),
     ("ui", "cursor", "INPUT", "Period Select", "thismonth | thisyear",
      "thisyear sends the current year; thismonth sends nothing.", {"step": "01"})],
    [("frontend", "refresh", "TANSTACK", "Pie Query", "usePieChartQuery(show, viewBy)",
      "The year is derived in the hook, not in the component.", {"step": "02"}),
     ("frontend", "key", "CACHE KEY", "Query Key", "queryKeys.charts.pie(…)",
      "{mode,viewBy} — note the key stores viewBy, not the year.",
      {"step": "02", "tag": "E6"}),
     ("frontend", "send", "API CLIENT", "Request Function", "getPieCategoryData(t, y)",
      "year is omitted from params when undefined.", {"step": "03"}),
     TOKEN_CARD + ({"step": "03"},)],
    [LIMITER_CARD + ({"step": "04", "tag": "E1"},),
     ("backend", "server", "ROUTER", "Route Match", "chart.routes.js",
      "GET /getPieCategoryData → verifyToken → getPieCategoryData.", {"step": "04"}),
     VERIFY_CARD + ({"step": "04", "tag": "E2"},),
     ("backend", "gears", "CONTROLLER", "Request Handler", "getPieCategoryData()",
      "One try/catch around the cache, the range and the read.",
      {"step": "05", "tag": "E5"})],
    ("database", "bolt", "REDIS · SERVER CACHE", "Cache Lookup",
     "getCache(pie:<id>:<year>:<type>)",
     "Read before the user is validated. 300 s TTL, key per period and type.",
     {"step": "06", "tag": "E4",
      "branches": [("HIT → 200 cached", "database"), ("MISS → continue", "backend")]}),
    [USER_CARD + ({"step": "07", "tag": "E3"},),
     ("backend", "gauge", "RESOLVE", "Range Resolution", "resolveYearRange / Month",
      "Selected year when given, else the current calendar month.", {"step": "07"}),
     ("database", "database", "MONGODB · PRIMARY DATA", "Read and Group",
      "getCategoryBreakdown(…)",
      "Shared with CHARTS-06; type decides totals or counts.", {"step": "08"}),
     ("response", "send", "RESPONSE", "Cache Write + 200 OK", "setCache(key, result)",
      "Default 300 s TTL, then { success, data }.", {"step": "09"})],
    [("insights", "sigma", "DERIVED", "Series Array", "pieChartQuery.data.data",
      "Falls back to [] unless success is true and data is an array.",
      {"step": "10"}),
     ("ui", "chart", "UI", "Pie Chart", "<PieChartWrapper/>",
      "dataKey total; recharts computes each slice percentage.", {"step": "11"})],
    [("insights", "send", "FAN-OUT", "Insight Trigger", "notifyChartFilterApplied",
      "The same array is also handed to the chart insights flow.", {"step": "11"})],
    ("Percentages are recharts', not ours", [
        "The backend returns absolute totals only.",
        "Recharts computes each slice from the series it is given.",
        "So percentages total 100 % of the returned range, not of all spending.",
    ], "insights"),
    COMMON_BAND[:2] + [
        ("E3", "401 User does not exist", "UserModel.findById → null",
         "Checked only on a cache miss, because the cache is read first."),
        ("E4", "Cache read precedes auth", "getCache before findById",
         "A warm entry answers before the user record is checked, so a deleted account "
         "still receives data until the 300 s TTL expires."),
        ("E5", "500 Internal Server Error", "catch (err)",
         "A read failure surfaces here with a generic body. Redis errors do not — the "
         "cache helpers swallow their own."),
        ("E6", "Key stores viewBy, not the year", "queryKeys.charts.pie({mode,viewBy})",
         "The client key records thisyear rather than 2026. Across a New Year boundary "
         "a cached entry can be reused for the wrong year until it expires."),
    ],
    "One of only two chart routes with a server cache. Expense mutations clear it via "
    "clearUserExpenseCache, because setCache registers the key per user.",
    ("ONE RANGE READ → ONE SERIES",
     [("category", "the group key"), ("total", "sum, or a count when type=count")]))


cached_pie(
    "CHARTS-09", "charts-api-09-pie-budget-comparison-detailed.svg",
    "GET /chart/getcomparisonforpie — detailed implementation workflow", "11 stages",
    [("ui", "window", "ROUTE", "Chart Route", "LandingPage.js · /chart/pie",
      "Same page as CHARTS-08.", {"step": "01"}),
     ("ui", "cursor", "STATE", "Comparison Mode", "show === 'comparison'",
      "The period selector is hidden in this mode.", {"step": "01"}),
     ("ui", "layout", "FIXED", "No Parameters", "always current month",
      "The month is decided by the server clock, not the user.", {"step": "01"})],
    [("frontend", "refresh", "TANSTACK", "Pie Query", "usePieChartQuery('comparison')",
      "Single branch; no arguments are forwarded.", {"step": "02"}),
     ("frontend", "key", "CACHE KEY", "Query Key", "queryKeys.charts.pie(…)",
      "{mode:\"comparison\"} — one entry regardless of month.", {"step": "02"}),
     ("frontend", "send", "API CLIENT", "Request Function", "getPieComparisonData()",
      "No query parameters are sent at all.", {"step": "03"}),
     TOKEN_CARD + ({"step": "03"},)],
    [LIMITER_CARD + ({"step": "04", "tag": "E1"},),
     ("backend", "server", "ROUTER", "Route Match", "chart.routes.js",
      "GET /getcomparisonforpie → verifyToken → getcomparisonforpie.", {"step": "04"}),
     VERIFY_CARD + ({"step": "04", "tag": "E2"},),
     ("backend", "gears", "CONTROLLER", "Request Handler", "getcomparisonforpie()",
      "One try/catch around the cache, the lookup and the mapping.",
      {"step": "05", "tag": "E5"})],
    ("database", "bolt", "REDIS · SERVER CACHE", "Cache Lookup",
     "getCache(pieComparison:<id>:<mon>)",
     "Key uses a hardcoded en-US month string. Read before user validation.",
     {"step": "06", "tag": "E6",
      "branches": [("HIT → 200 cached", "database"), ("MISS → continue", "backend")]}),
    [USER_CARD + ({"step": "07", "tag": "E3"},),
     ("database", "database", "MONGODB · BUDGET DATA", "Budget Lookup",
      "BudgetModel.findOne({ month })",
      "One document. Absent budget returns a zeroed pair, uncached.",
      {"step": "07", "tag": "E4"}),
     ("backend", "layers", "TRANSFORM", "Remaining vs Spent", "Math.max(0, b − s)",
      "Overspending is clamped, so the pie never shows a negative slice.",
      {"step": "08"}),
     ("response", "send", "RESPONSE", "Cache Write + 200 OK", "setCache(key, result)",
      "Default 300 s TTL, then { success, data }.", {"step": "09"})],
    [("insights", "sigma", "DERIVED", "Series Array", "pieChartQuery.data.data",
      "Falls back to [] unless success is true and data is an array.",
      {"step": "10"}),
     ("ui", "chart", "UI", "Pie Chart", "<PieChartWrapper/>",
      "Two slices; recharts computes the split.", {"step": "11"})],
    [("insights", "send", "FAN-OUT", "Insight Trigger", "notifyChartFilterApplied",
      "The same array is also handed to the chart insights flow.", {"step": "11"})],
    ("Clamping hides overspend", [
        "Remaining is floored at zero, so overspending renders as a full Spent slice "
        "with no signal of by how much.",
        "The absolute overspend is not returned anywhere in this response.",
    ], "insights"),
    COMMON_BAND[:2] + [
        ("E3", "401 User does not exist", "UserModel.findById → null",
         "Checked only on a cache miss, because the cache is read first."),
        ("E4", "Repair-on-read is best effort", "syncRecoveryService.repairIfPending",
         "The budget comparison repairs pending derived spend before lookup; a failed "
         "repair leaves the existing stored value in place for this response."),
        ("E5", "500 Internal Server Error", "catch (err)",
         "A read failure surfaces here with a generic body."),
        ("E6", "Month key is hardcoded en-US", "toLocaleString('en-US', …)",
         "The budget module writes its month key with the server's default locale. On "
         "a non-English host the two disagree and no budget is ever found."),
    ],
    "Reads budget data written by BUDGET-02 and BUDGET-03 without calling those "
    "endpoints. See budget/README.md for how spent is maintained.",
    ("ONE BUDGET ROW → TWO SLICES",
     [("Remaining", "budget − spent, floored at 0"), ("Spent", "the stored spent field")]))


# ===========================================================================
# FLOW-01 — frontend-only chart insights
# ===========================================================================
d = Diagram(T, title="Chart insights — detailed frontend-only workflow",
            subtitle="Level 2 · no endpoint exists · badges map to the 9 stages in "
                     "charts-flow-01-chart-insights-overview.svg")
r1 = d.region(20, 272, "Chart Page & Controls", "Route, filters, selectors",
              accent="ui", step=1)
r2 = d.region(306, 272, "Frontend Data Layer", "The already-cached chart response",
              accent="frontend", step=2)
r3 = d.region(592, 272, "React Context", "State that is not a query cache",
              accent="insights", step=3)
r4 = d.region(878, 272, "Insight Rules", "Pure functions over the chart array",
              accent="insights", step=4)
r5 = d.region(1164, 496, "Chart Rendering", "Where the two consumers diverge",
              accent="ui", step=5)

a = stack(d, r1, [
    ("ui", "window", "ROUTE", "Chart Route", "all three chart routes",
     "All three chart pages run this same flow.", {"step": "01"}),
    ("ui", "layout", "EFFECT", "Page Effect", "useEffect on query data",
     "Fires once per new successful fetch, per page.", {"step": "02"}),
    ("ui", "cursor", "RESET", "Filter Change", "clearChartInsights()",
     "Any filter change wipes the card before the next fetch.",
     {"step": "09"}),
])
b = stack(d, r2, [
    ("frontend", "refresh", "TANSTACK · CLIENT CACHE", "Cached Response",
     "chartQuery.data.data",
     "Already fetched by CHARTS-02 … CHARTS-09. Nothing new is requested.",
     {"step": "01"}),
    ("frontend", "sigma", "GUARD", "Shape Check", "success && Array.isArray(data)",
     "A non-array or failed response skips the notification entirely.",
     {"step": "02", "tag": "E1"}),
    ("frontend", "send", "HAND-OFF", "Notify Context", "notifyChartFilterApplied",
     "Passes the array, the chart type and the active filter.", {"step": "03"}),
])
c = stack(d, r3, [
    ("insights", "gears", "CONTEXT", "Chart Insights Context", "ChartInsightsContext",
     "Provider state, not a TanStack entry — never persisted or refetched.",
     {"step": "04"}),
    ("insights", "key", "ROUTING", "Rule Selection", "chart === line | bar | pie",
     "Line is skipped entirely while compare-by-year is on.",
     {"step": "04", "tag": "E2"}),
    ("insights", "alert", "GUARD", "Payload Check", "!insight || !insight.payload",
     "A null finding sets ready true with no text, so nothing renders.",
     {"step": "04", "tag": "E3"}),
])
e = stack(d, r4, [
    ("insights", "chart", "RULE", "Line Finding", "lineChartFinding(data)",
     "Trend direction and extremes over the series.", {"step": "05"}),
    ("insights", "layers", "RULE", "Bar Finding", "barChartFinding(data, filter)",
     "Branches on the active bar filter.", {"step": "05"}),
    ("insights", "sigma", "RULE", "Pie Finding", "pieChartFinding(data, filter)",
     "Branches on distribution, count or comparison.", {"step": "05"}),
    ("insights", "file-text", "TEMPLATE", "Insight Text", "chartInsightTemplates",
     "Maps the finding payload to a user-facing string.", {"step": "06"}),
    ("insights", "key", "STATE", "Context State", "chartInsights + generatedAt",
     "Held in Context; there is no query key and no invalidation.",
     {"step": "07", "tag": "E4"}),
])
d.handoff(a[1], b[0], 299); d.handoff(b[2], c[0], 585); d.handoff(c[2], e[0], 871)
d.note_box(r4.card_x, e[-1].bottom + 20, CW, 126, "No network at any stage", [
    "There is no chart insights endpoint. Every stage here runs in the browser.",
    "The input is a response another chart query already placed in the cache.",
], "insights")

f0 = d.card(1180, Y0, "insights", "monitor", "CONTEXT CONSUMER", "Insight Card",
            "<InlineChartInsight/>",
            "Rendered beneath the chart on all three pages.", w=464, step="08")
d.handoff(e[-1], f0, 1157, kind="response", width=T["stroke"]["responsePath"],
          label="CONTEXT VALUE")
d.sub_region(SUB_L, 232, SUB_W, 342, "Insight card", "insights")
d.sub_region(SUB_R, 232, SUB_W, 342, "The chart itself", "ui")
LY = 264
g = [d.card(1180, LY + i * PITCH, *sp[:6], **sp[6]) for i, sp in enumerate([
    ("insights", "gauge", "GUARD", "Ready Flag", "isChartInsightReady",
     "Set true even when the text is null, so the card can be empty.",
     {"step": "08"}),
    ("insights", "file-text", "TEXT", "Insight Item", "chartInsightText",
     "A single item, unlike the expense insights which return a list.",
     {"step": "08"}),
    ("ui", "monitor", "UI", "Inline Card", "<InlineChartInsight/>",
     "Renders nothing at all when the text is null.", {"step": "08"}),
])]
d.flow_down(g[0], g[1]); d.flow_down(g[1], g[2])
h = [d.card(1420, LY + i * PITCH, *sp[:6], **sp[6]) for i, sp in enumerate([
    ("ui", "chart", "PARALLEL", "Chart Wrapper", "Trend / Bar / Pie wrapper",
     "Reads the same cached array independently.", {"step": "08"}),
    ("ui", "sigma", "NOTE", "No Shared State", "props only",
     "The chart never reads the insight context.", {"step": "08"}),
])]
d.flow_down(h[0], h[1])
d.path([(g[0].right - 30, f0.bottom), (g[0].right - 30, g[0].y)], "insights",
       width=T["stroke"]["primaryPath"])
d.path([(h[0].right - 30, f0.bottom), (h[0].right - 30, h[0].y)], "ui",
       width=T["stroke"]["primaryPath"])
d.note_box(1420, 264 + 2 * PITCH + 8, 224, 190, "Two independent readers", [
    "The chart and the insight card both read the same cached array.",
    "Neither mutates it, and neither depends on the other's state.",
], "ui")

x = band(d, [
    ("E1", "Silent on a bad shape", "success && Array.isArray(data)",
     "A failed or non-array response skips the notification, leaving whatever the "
     "previous filter produced until clearChartInsights runs."),
    ("E2", "Compare mode has no insight", "chart === 'line' && !compareByYear",
     "Multi-year comparison deliberately produces no finding, and the absence is not "
     "explained in the UI."),
    ("E3", "Null finding renders nothing", "!insight || !insight.payload",
     "isChartInsightReady is set true with a null payload, so the card is mounted "
     "empty rather than showing a fallback."),
    ("E4", "Context state is never invalidated", "ChartInsightsContext",
     "The insight lives outside TanStack Query, so a mutation that invalidates chart "
     "queries does not clear it — only a filter change does."),
    ("E5", "No error path at all", "no isError branch",
     "None of the three pages inspect the query's error state before notifying, so a "
     "failure simply produces no card."),
    ("E6", "Not persisted across navigation", "provider state",
     "Leaving and returning to a chart page resets the insight until the next "
     "successful fetch."),
])
refs(d, [((b[1].right, b[1].cy), 566, 0, x[0], "left"),
         ((c[1].x, c[1].cy), 604, 1, x[1], "top-offset"),
         ((c[2].right, c[2].cy), 852, 2, x[2], "top"),
         ((e[-1].right, e[-1].cy), 1132, 3, x[3], "top"),
         ((a[1].cx, a[1].bottom), a[1].cx, 4, x[4], "top"),
         ((g[-1].right, g[-1].cy), 1412, 5, x[5], "top")])
finish(d, "charts-flow-01-chart-insights-detailed.svg", "CHARTS-FLOW-01",
       "No API, no Redis and no query cache entry of its own — this flow reads a "
       "response that a chart query already fetched.")
