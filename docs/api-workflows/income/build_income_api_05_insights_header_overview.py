"""INCOME-05 Level 1 — POST /income/insights-header

A read expressed as a POST, because the period selector travels in the request body.
Ten stages: nine straight across, then the consumer below the last one.

    row 1   01  02  03  04  05  06  07  08  09
    row 2                                     10
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _income_common import new, error_card, no_redis_box   # noqa: E402

o = new("POST /income/insights-header — period summary cards",
        "Quick overview · follow 01 → 10 · full detail in income-api-05-insights-header-detailed.svg")
d, R1, R2 = o.d, o.ROW1, o.ROW2

d.facts_panel(34, o.BAND_Y, 836, o.BAND_H, "At a glance", [
    ("Endpoint",  "POST /income/insights-header",        "response"),
    ("Body",      "{ period }",                          "backend"),
    ("Periods",   "current_month or financial_year only", "backend"),
    ("Database",  "MongoDB · income + expense, in parallel", "database"),
    ("Returns",   "Totals, top source, count, balance",  "response"),
])
no_redis_box(o, 882, o.BAND_Y, 516)

s = [
    o.card(0, R1, "ui", "layout", "01", "Insights Page", "IncomeInsights",
           "Holds the period selector state."),
    o.card(1, R1, "frontend", "refresh", "02", "Summary Query", "TanStack Query",
           "Key includes the chosen period."),
    o.card(2, R1, "auth", "key", "03", "Authorized Request", "Axios Client",
           "POST with the JWT and { period }."),
    o.card(3, R1, "auth", "shield", "04", "API Security", "Limiter + JWT",
           "IP rate limit, then JWT validation."),
    o.card(4, R1, "backend", "user-check", "05", "User Validation", "getInsightsHeader",
           "Confirms the account still exists."),
    o.card(5, R1, "auth", "gauge", "06", "Period Resolution", "resolvePeriod",
           "Unknown period is rejected with 400."),
    o.card(6, R1, "database", "database", "07", "Parallel Reads", "MongoDB",
           "Income and expenses for the range, together."),
    o.card(7, R1, "backend", "sigma", "08", "Header Aggregation", "Reduce",
           "Totals, top source, count and balance."),
    o.card(8, R1, "response", "send", "09", "Respond", "200 OK",
           "Five summary numbers, no records."),
]
s10 = o.card(8, R2, "ui", "monitor", "10", "Summary Cards", "Header",
             "Renders zeros until the query resolves.")
o.chain(s, o.R1_CY)
d.path([(s[8].cx, s[8].bottom), (s[8].cx, s10.y)], "ui", width=2.8,
       label="SINGLE CONSUMER", label_at=(s[8].cx, o.LABEL_Y))

error_card(o, o.COL[8], 458, o.CW, "Top source is wrong",
           ["The reduce that picks the", "largest source returns the last", "record, not the biggest."])
d.path([(s10.right, o.R2_CY), (1584, o.R2_CY), (1584, 502), (o.COL[8] + o.CW, 502)],
       "error", dashed=True)

svg = o.render(["Both income insight routes run the same two queries over the same range; only the "
                "numbers they derive from them differ."], "INCOME-05")
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "insights-header",
                  "income-api-05-insights-header-overview.svg"), "w", encoding="utf-8").write(svg)
print("wrote income-api-05-insights-header-overview.svg", len(svg))
