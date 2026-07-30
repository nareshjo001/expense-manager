"""
Level 1 overviews for the whole charts module — one file, ten outputs.

Two shapes are used, both taken from the approved system:

  * READ (no server cache): stages run straight across row 1; where a consumer is
    named separately it sits below the last stage.
  * CACHED READ (the two pie routes only): row 1 carries the request up to the cache
    decision, an empty column carries the hit short-circuit forward, and the miss
    lane runs left-to-right in row 2. No backward connectors in either shape.

Run:  python3 build_charts_overviews.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _charts_common import new, error_card, no_redis_box, save   # noqa: E402


# ---------------------------------------------------------------------------
def read_chart(api_id, out, title, subtitle, facts, stages, consumer=None,
               err=None, footer="", note=None):
    """Straight read: stages across row 1, optional consumer below the last one."""
    o = new(title, subtitle)
    d = o.d
    o.d.facts_panel(34, o.BAND_Y, 836, o.BAND_H, "At a glance", facts)
    if note:
        d.note_box(882, o.BAND_Y, 516, 150, note[0], note[1], note[2])
    else:
        no_redis_box(o, 882, o.BAND_Y, 516)

    cards = [o.card(i, o.ROW1, *s) for i, s in enumerate(stages)]
    o.chain(cards, o.R1_CY)

    last = cards[-1]
    if consumer:
        c = o.card(8, o.ROW2, *consumer)
        d.path([(cards[-1].cx, cards[-1].bottom), (cards[-1].cx, c.y)], "ui", width=2.8,
               label="RENDERED BY", label_at=(cards[-1].cx, o.LABEL_Y))
        last = c

    if err:
        error_card(o, o.COL[8], 458, o.CW, err[0], err[1])
        d.path([(last.right, last.cy if consumer else o.R1_CY),
                (1584, last.cy if consumer else o.R1_CY), (1584, 502),
                (o.COL[8] + o.CW, 502)], "error", dashed=True)

    save(o, o.render([footer], api_id), out)


# ---------------------------------------------------------------------------
def cached_chart(api_id, out, title, subtitle, facts, top, miss, tail,
                 err, footer, chips=None):
    """Cached read: hit short-circuits across the empty column, miss runs in row 2."""
    o = new(title, subtitle)
    d = o.d
    d.group_box(882, o.BAND_Y, 516, o.BAND_H, "Miss path", "database")
    d.facts_panel(34, o.BAND_Y, 836, o.BAND_H, "At a glance", facts)

    t = [o.card(i, o.ROW1, *s) for i, s in enumerate(top)]          # cols 0..5
    r = [o.card(7 + i, o.ROW1, *s) for i, s in enumerate(tail)]     # cols 7,8
    m = [o.card(5 + i, o.ROW2, *s) for i, s in enumerate(miss)]     # cols 5,6,7

    o.chain(t, o.R1_CY)
    o.chain(m, o.R2_CY)
    d.path([(t[5].right, o.R1_CY), (r[0].x, o.R1_CY)], "database", width=2.8,
           label="CACHE HIT · cached 200 OK", label_at=(1144, o.R1_CY))
    d.path([(t[5].cx, t[5].bottom), (t[5].cx, m[0].y)], "database", width=2.8,
           label="CACHE MISS", label_at=(t[5].cx, o.LABEL_Y))
    d.path([(m[2].cx, m[2].y), (m[2].cx, r[0].bottom)], "response", width=3.0,
           label="200 OK", label_at=(m[2].cx, o.LABEL_Y))
    d.path([(r[0].right, o.R1_CY), (r[1].x, o.R1_CY)], "ui", width=2.8)

    if chips:
        d.top.append(d._text(894, 452, chips[0], 9.6, d.pal("database")["ink"], 700, ls=0.9))
        for i, (n, desc) in enumerate(chips[1]):
            d.dataset_chip(894, 462 + i * 30, 500, 26, n, desc)

    error_card(o, o.COL[8], 458, o.CW, err[0], err[1])
    d.path([(r[1].right, o.R1_CY), (1584, o.R1_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
           "error", dashed=True)
    save(o, o.render([footer], api_id), out)


AUTH = ("auth", "key", "03", "Authorized Request", "Axios Client",
        "Attaches the stored JWT, sends it.")
SEC = ("auth", "shield", "04", "API Security", "Limiter + JWT",
       "IP rate limit, then JWT validation.")


# === CHARTS-01 =============================================================
read_chart(
    "CHARTS-01", "charts-api-01-logged-years-overview.svg",
    "GET /chart/getloggedyears — which years have data",
    "Quick overview · follow 01 → 09 · full detail in charts-api-01-logged-years-detailed.svg",
    [("Endpoint", "GET /chart/getloggedyears", "response"),
     ("Auth", "Bearer JWT, checked every request", "auth"),
     ("Server cache", "None on this route", "database"),
     ("Database", "MongoDB $group on $year", "database"),
     ("Feeds", "The year picker, not a chart", "ui")],
    [("ui", "layout", "01", "Trend Chart Page", "TrendChartPage", "Mounts on /chart/line."),
     ("frontend", "refresh", "02", "Years Query", "TanStack Query", "Fetched once, no filter input."),
     AUTH, SEC,
     ("backend", "user-check", "05", "User Validation", "getloggedyears", "Confirms the account still exists."),
     ("database", "database", "06", "Distinct Years", "MongoDB", "$group by $year, sorted ascending."),
     ("response", "send", "07", "Respond", "200 OK", "A plain array of year numbers."),
     ("frontend", "refresh", "08", "Client Cache", "TanStack Query", "Key [\"charts\",\"logged-years\"]."),
     ("ui", "cursor", "09", "Year Picker", "react-select", "Options for the multi-year comparison.")],
    err=("Empty year picker",
         ["availableYears falls back to []", "so the selector is simply empty —", "no message is shown."]),
    footer="This endpoint feeds a control, not a chart. It is the only chart route whose response "
           "never reaches a visualisation.")

# === CHARTS-02 =============================================================
read_chart(
    "CHARTS-02", "charts-api-02-trend-by-week-overview.svg",
    "GET /chart/linechartbyweek — weekly spend inside one month",
    "Quick overview · follow 01 → 10 · full detail in charts-api-02-trend-by-week-detailed.svg",
    [("Endpoint", "GET /chart/linechartbyweek", "response"),
     ("Query", "selectedYear + selectedMonth", "backend"),
     ("Range", "Calendar month, server local time", "backend"),
     ("Server cache", "None on this route", "database"),
     ("Aggregation", "Backend JavaScript, not MongoDB", "backend")],
    [("ui", "cursor", "01", "Month Picker", "TrendChartPage", "A month input supplies YYYY-MM."),
     ("frontend", "refresh", "02", "Trend Query", "TanStack Query", "Mode week; key holds the month."),
     AUTH, SEC,
     ("backend", "user-check", "05", "User Validation", "linechartbyweek", "Confirms the account still exists."),
     ("auth", "gauge", "06", "Param Guard", "Presence Only", "400 when either param is missing."),
     ("database", "database", "07", "Month Read", "MongoDB", "One inclusive calendar-month range."),
     ("backend", "layers", "08", "Week Bucketing", "bucketByWeek", "Monday-start weeks, relabelled 1..N."),
     ("response", "send", "09", "Respond", "200 OK", "[{ week, total }] for weeks with spend.")],
    consumer=("ui", "chart", "10", "Line Chart", "TrendChartWrapper", "Week labels along the x axis."),
    err=("Positional labels",
         ["Only weeks with spend appear,", "renumbered from 1 — so “Week 2”", "may be the 4th calendar week."]),
    footer="Weeks with no spending are dropped, not zero-filled, and the surviving weeks are "
           "renumbered sequentially.")

# === CHARTS-03 =============================================================
read_chart(
    "CHARTS-03", "charts-api-03-trend-by-month-overview.svg",
    "GET /chart/linechartbymonth — monthly spend across one year",
    "Quick overview · follow 01 → 10 · full detail in charts-api-03-trend-by-month-detailed.svg",
    [("Endpoint", "GET /chart/linechartbymonth", "response"),
     ("Query", "selectedYear", "backend"),
     ("Range", "Calendar year, server local time", "backend"),
     ("Server cache", "None on this route", "database"),
     ("Aggregation", "Backend JavaScript, not MongoDB", "backend")],
    [("ui", "cursor", "01", "Year Input", "TrendChartPage", "Free-text year, four digits."),
     ("frontend", "refresh", "02", "Trend Query", "TanStack Query", "Mode month; key holds the year."),
     AUTH, SEC,
     ("backend", "user-check", "05", "User Validation", "linechartbymonth", "Confirms the account still exists."),
     ("auth", "gauge", "06", "Year Guard", "Number + isNaN", "400 when the year is absent or not numeric."),
     ("database", "database", "07", "Year Read", "MongoDB", "One inclusive calendar-year range."),
     ("backend", "layers", "08", "Monthly Totals", "monthlyTotals", "Twelve buckets, then zeros removed."),
     ("response", "send", "09", "Respond", "200 OK", "[{ month, total }] for months with spend.")],
    consumer=("ui", "chart", "10", "Line Chart", "TrendChartWrapper", "Month names along the x axis."),
    err=("Gaps, not zeros",
         ["Months with no spending are", "filtered out, so the line jumps", "straight from Jan to Apr."]),
    footer="The twelve-month array is built and then filtered down to months with a positive total, "
           "so absent months leave gaps rather than zero points.")

# === CHARTS-04 =============================================================
read_chart(
    "CHARTS-04", "charts-api-04-trend-by-year-overview.svg",
    "GET /chart/linechartbyyear — spend totalled per year",
    "Quick overview · follow 01 → 09 · full detail in charts-api-04-trend-by-year-detailed.svg",
    [("Endpoint", "GET /chart/linechartbyyear", "response"),
     ("Query", "None — takes no parameters", "backend"),
     ("Range", "Unbounded: every expense ever", "backend"),
     ("Server cache", "None on this route", "database"),
     ("Aggregation", "Backend JavaScript, not MongoDB", "backend")],
    [("ui", "cursor", "01", "By Year Selected", "TrendChartPage", "No further input needed."),
     ("frontend", "refresh", "02", "Trend Query", "TanStack Query", "Mode year; key takes no argument."),
     AUTH, SEC,
     ("backend", "user-check", "05", "User Validation", "linechartbyyear", "Confirms the account still exists."),
     ("database", "database", "06", "Full History Read", "MongoDB", "No date filter — the whole collection."),
     ("backend", "layers", "07", "Group By Year", "groupByYear", "Sums each calendar year present."),
     ("response", "send", "08", "Respond", "200 OK", "[{ year, total }] in insertion order."),
     ("ui", "chart", "09", "Line Chart", "TrendChartWrapper", "Year labels along the x axis.")],
    err=("Unbounded read",
         ["No range filter and no limit —", "every expense the user owns is", "loaded on each request."]),
    footer="The only chart route with no date bound at all: it reads the entire expense collection "
           "for the user and groups in Node.")

# === CHARTS-05 =============================================================
read_chart(
    "CHARTS-05", "charts-api-05-trend-between-years-overview.svg",
    "GET /chart/linechartbetweenyears — comparing years month by month",
    "Quick overview · follow 01 → 10 · full detail in charts-api-05-trend-between-years-detailed.svg",
    [("Endpoint", "GET /chart/linechartbetweenyears", "response"),
     ("Query", "years=2024,2025 (comma list)", "backend"),
     ("Range", "Min year Jan 1 to max year Dec 31", "backend"),
     ("Server cache", "None on this route", "database"),
     ("Shape", "One row per month, one key per year", "backend")],
    [("ui", "cursor", "01", "Year Multi-Select", "react-select", "Options come from CHARTS-01."),
     ("frontend", "refresh", "02", "Trend Query", "TanStack Query", "Mode betweenYears; years in the key."),
     AUTH, SEC,
     ("backend", "user-check", "05", "User Validation", "linechartbetweenyears", "Confirms the account still exists."),
     ("auth", "gauge", "06", "Years Guard", "split + isNaN", "400 when absent or not all numeric."),
     ("database", "database", "07", "Span Read", "MongoDB", "One range covering min to max year."),
     ("backend", "layers", "08", "Month × Year Grid", "getMultiYearLineChart", "Twelve rows, then empty rows removed."),
     ("response", "send", "09", "Respond", "200 OK", "[{ month, 2024, 2025 }] rows.")],
    consumer=("ui", "chart", "10", "Multi Line Chart", "MultiTrendChartWrapper", "One line per selected year."),
    err=("Zero rows dropped",
         ["A month is removed only if every", "selected year is zero, so a year", "can still show a false 0 point."]),
    footer="The grid is built for all twelve months, then rows where every selected year is zero are "
           "removed — so remaining rows may still contain genuine zeros.")

# === CHARTS-06 =============================================================
read_chart(
    "CHARTS-06", "charts-api-06-bar-by-category-overview.svg",
    "GET /chart/barchartbycategory — spend per category",
    "Quick overview · follow 01 → 10 · full detail in charts-api-06-bar-by-category-detailed.svg",
    [("Endpoint", "GET /chart/barchartbycategory", "response"),
     ("Query", "month=YYYY-MM, optional", "backend"),
     ("Default", "Current calendar year when absent", "backend"),
     ("Server cache", "None on this route", "database"),
     ("Shares", "getCategoryBreakdown with CHARTS-08", "backend")],
    [("ui", "cursor", "01", "Category View", "BarChartPage", "Optional “specific month” checkbox."),
     ("frontend", "refresh", "02", "Bar Query", "TanStack Query", "Mode category; month in the key."),
     AUTH, SEC,
     ("backend", "user-check", "05", "User Validation", "barchartbycategory", "Confirms the account still exists."),
     ("backend", "gauge", "06", "Range Resolution", "chartRangeResolver", "Chosen month, else the current year."),
     ("database", "database", "07", "Range Read", "MongoDB", "One inclusive range for the user."),
     ("backend", "layers", "08", "Category Totals", "categoryTotals", "Group by category, then sum."),
     ("response", "send", "09", "Respond", "200 OK", "[{ category, total }], unsorted.")],
    consumer=("ui", "chart", "10", "Bar Chart", "BarChartWrapper", "One bar per category."),
    err=("No month guard",
         ["month=abc parses to NaN and", "produces an Invalid Date range,", "which surfaces as a 500."]),
    footer="Categories arrive in object-key order, not sorted by value, so bar order can change "
           "between requests.")

# === CHARTS-07 =============================================================
read_chart(
    "CHARTS-07", "charts-api-07-bar-budget-vs-spend-overview.svg",
    "GET /chart/barchartbymonth — budget against spending",
    "Quick overview · follow 01 → 10 · full detail in charts-api-07-bar-budget-vs-spend-detailed.svg",
    [("Endpoint", "GET /chart/barchartbymonth", "response"),
     ("Query", "year", "backend"),
     ("Reads", "BudgetModel — not the expense collection", "database"),
     ("Server cache", "None on this route", "database"),
     ("Join", "Already joined: spent lives on the budget row", "backend")],
    [("ui", "cursor", "01", "Month View", "BarChartPage", "A year input drives the request."),
     ("frontend", "refresh", "02", "Bar Query", "TanStack Query", "Mode month; year in the key."),
     AUTH, SEC,
     ("backend", "user-check", "05", "User Validation", "barchartbymonth", "Confirms the account still exists."),
     ("auth", "gauge", "06", "Year Guard", "Presence Only", "400 only when the year is absent."),
     ("database", "database", "07", "Budget Read", "MongoDB", "Month strings matched by regex."),
     ("backend", "layers", "08", "Map and Sort", "MONTH_ORDER", "Split the month key, order Jan→Dec."),
     ("response", "send", "09", "Respond", "200 OK", "[{ month, budget, total }] rows.")],
    consumer=("ui", "chart", "10", "Double Bar Chart", "BarChartWrapper", "Budget and spend, side by side."),
    err=("Year not validated",
         ["The raw string is interpolated", "into a RegExp, so a pattern like", "“.*” matches every month."]),
    footer="Budget and spend are not joined here — spent is a stored field on the budget document, "
           "written by the budget module.",
    note=("No expense query on this route", [
        "This endpoint never touches the expense collection. It reads BudgetModel only.",
        "The spent figure comes from the budget row, refreshed by the budget and expense modules.",
    ], "database"))

# === CHARTS-08 =============================================================
cached_chart(
    "CHARTS-08", "charts-api-08-pie-category-overview.svg",
    "GET /chart/getPieCategoryData — category share of spending",
    "Quick overview · follow 01 → 11 · full detail in charts-api-08-pie-category-detailed.svg",
    [("Endpoint", "GET /chart/getPieCategoryData", "response"),
     ("Query", "type=total|count, year optional", "backend"),
     ("Default", "Current month when no year given", "backend"),
     ("Server cache", "Redis · pie:<user>:<year>:<type> · 5 min", "database"),
     ("Shares", "getCategoryBreakdown with CHARTS-06", "backend")],
    [("ui", "cursor", "01", "Pie View", "PieChartPage", "Distribution or count, month or year."),
     ("frontend", "refresh", "02", "Pie Query", "TanStack Query", "Key carries mode and viewBy."),
     AUTH, SEC,
     ("backend", "gears", "05", "Request Processing", "getPieCategoryData", "Coordinates cache and database."),
     ("database", "bolt", "06", "Cache Decision", "Redis Cache", "Read before the user is validated.")],
    [("backend", "user-check", "07", "User + Range", "chartRangeResolver", "Validates, then resolves the range."),
     ("database", "database", "08", "Read and Group", "MongoDB", "Category totals or transaction counts."),
     ("response", "send", "09", "Cache and Respond", "Redis Write + 200", "Stores for five minutes, returns.")],
    [("frontend", "refresh", "10", "Client Cache", "TanStack Query", "Key [\"charts\",\"pie\",filters]."),
     ("ui", "chart", "11", "Pie Chart", "PieChartWrapper", "Slice percentages computed by recharts.")],
    err=("Cache before auth",
         ["A warm entry answers before", "the user record is checked —", "same pattern as /last-week."]),
    footer="One of only two chart routes with a server cache. A hit skips user validation, the range "
           "resolution, the read and the grouping.",
    chips=("ONE RANGE READ → ONE SERIES",
           [("category", "the group key"), ("total", "sum, or count when type=count")]))

# === CHARTS-09 =============================================================
cached_chart(
    "CHARTS-09", "charts-api-09-pie-budget-comparison-overview.svg",
    "GET /chart/getcomparisonforpie — this month's budget usage",
    "Quick overview · follow 01 → 11 · full detail in charts-api-09-pie-budget-comparison-detailed.svg",
    [("Endpoint", "GET /chart/getcomparisonforpie", "response"),
     ("Query", "None — always the current month", "backend"),
     ("Reads", "BudgetModel — not the expense collection", "database"),
     ("Server cache", "Redis · pieComparison:<user>:<Mon YYYY> · 5 min", "database"),
     ("Month key", "Built with the en-US locale, hardcoded", "error")],
    [("ui", "cursor", "01", "Comparison View", "PieChartPage", "No period selector for this mode."),
     ("frontend", "refresh", "02", "Pie Query", "TanStack Query", "Key is mode comparison only."),
     AUTH, SEC,
     ("backend", "gears", "05", "Request Processing", "getcomparisonforpie", "Coordinates cache and database."),
     ("database", "bolt", "06", "Cache Decision", "Redis Cache", "Read before the user is validated.")],
    [("backend", "user-check", "07", "User + Lookup", "getBudgetComparison", "One budget row for this month."),
     ("backend", "layers", "08", "Remaining vs Spent", "Math.max(0, b − s)", "Overspend is clamped to zero."),
     ("response", "send", "09", "Cache and Respond", "Redis Write + 200", "Stores for five minutes, returns.")],
    [("frontend", "refresh", "10", "Client Cache", "TanStack Query", "Key [\"charts\",\"pie\",{comparison}]."),
     ("ui", "chart", "11", "Pie Chart", "PieChartWrapper", "Two slices: remaining and spent.")],
    err=("Stale after edit",
         ["Budget writes never clear this", "key, so the pie can lag a new", "budget by up to five minutes."]),
    footer="No budget row yields a zeroed two-slice response that is deliberately not cached, so the "
           "chart recovers as soon as a budget exists.",
    chips=("ONE BUDGET ROW → TWO SLICES",
           [("Remaining", "budget − spent, floored at 0"), ("Spent", "the stored spent field")]))

# === FLOW-01 ===============================================================
read_chart(
    "CHARTS-FLOW-01", "charts-flow-01-chart-insights-overview.svg",
    "Chart insights — a frontend-only workflow",
    "Quick overview · follow 01 → 09 · no network request is made at any stage",
    [("Trigger", "Any successful chart response", "frontend"),
     ("Network", "None — nothing is fetched here", "error"),
     ("State", "React Context, not TanStack Query", "insights"),
     ("Inputs", "The already-cached chart array", "frontend"),
     ("Output", "One inline insight card per page", "ui")],
    [("frontend", "refresh", "01", "Chart Data Lands", "TanStack Query", "A chart query resolves successfully."),
     ("ui", "layout", "02", "Page Effect", "useEffect", "Fires once per new successful fetch."),
     ("insights", "send", "03", "Context Notified", "notifyChartFilterApplied", "Receives the array, chart and filter."),
     ("insights", "gears", "04", "Rule Selection", "ChartInsightsContext", "Routes to the line, bar or pie rule."),
     ("insights", "sigma", "05", "Pattern Rule", "chartPatterns", "Derives a finding and a payload."),
     ("insights", "file-text", "06", "Template", "chartsTemplates", "Turns the payload into text."),
     ("insights", "key", "07", "Context State", "chartInsights", "Held in Context, not in a query cache."),
     ("ui", "monitor", "08", "Insight Card", "InlineChartInsight", "Rendered beneath the chart."),
     ("ui", "cursor", "09", "Cleared on Filter", "clearChartInsights", "Any filter change resets the card.")],
    err=("Silent when null",
         ["A null insight sets ready true", "with no text, so the card simply", "does not appear."]),
    footer="No API is involved. This flow consumes a response that CHARTS-02 to CHARTS-09 already "
           "placed in the TanStack cache.",
    note=("Frontend-only — no endpoint exists", [
        "There is no insights route for charts. Everything here runs in the browser on data that "
        "has already been fetched.",
        "State lives in React Context and is deliberately cleared whenever a chart filter changes.",
    ], "insights"))
