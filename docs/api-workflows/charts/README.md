# Charts module — API workflow documentation

Nine endpoints, all mounted under `/chart`, plus one frontend-only workflow. Every route
was discovered by reading `backend/Routes/chart.routes.js` and tracing outwards; none was
assumed from another module.

Diagrams reuse the approved BALENISA design system in
[`../diagram-tokens.json`](../diagram-tokens.json) and
[`../workflow_diagram.py`](../workflow_diagram.py). Nothing visual is module-specific.

## A. Unique chart-related API inventory

| API ID | Method | Endpoint | Backend handler | Frontend hook / function | Chart consumers | Status |
|---|---|---|---|---|---|---|
| [CHARTS-01](trend/logged-years/charts-api-01-logged-years.md) | GET | `/chart/getloggedyears` | `getloggedyears` | `useLoggedYearsQuery` / `getLoggedYears` | Year selector (control, not a chart) | Actively used |
| [CHARTS-02](trend/trend-by-week/charts-api-02-trend-by-week.md) | GET | `/chart/linechartbyweek` | `linechartbyweek` | `useTrendChartQuery` / `getTrendChartByWeek` | Line — weekly | Actively used |
| [CHARTS-03](trend/trend-by-month/charts-api-03-trend-by-month.md) | GET | `/chart/linechartbymonth` | `linechartbymonth` | `useTrendChartQuery` / `getTrendChartByMonth` | Line — monthly | Actively used |
| [CHARTS-04](trend/trend-by-year/charts-api-04-trend-by-year.md) | GET | `/chart/linechartbyyear` | `linechartbyyear` | `useTrendChartQuery` / `getTrendChartByYear` | Line — yearly | Actively used |
| [CHARTS-05](trend/trend-between-years/charts-api-05-trend-between-years.md) | GET | `/chart/linechartbetweenyears` | `linechartbetweenyears` | `useTrendChartQuery` / `getTrendChartBetweenYears` | Multi-line comparison | Actively used |
| [CHARTS-06](bar/bar-by-category/charts-api-06-bar-by-category.md) | GET | `/chart/barchartbycategory` | `barchartbycategory` | `useBarChartQuery` / `getBarChartByCategory` | Bar — by category | Actively used |
| [CHARTS-07](bar/bar-budget-vs-spend/charts-api-07-bar-budget-vs-spend.md) | GET | `/chart/barchartbymonth` | `barchartbymonth` | `useBarChartQuery` / `getBarChartByMonth` | Bar — budget vs spend | Actively used |
| [CHARTS-08](pie/pie-category/charts-api-08-pie-category.md) | GET | `/chart/getPieCategoryData` | `getPieCategoryData` | `usePieChartQuery` / `getPieCategoryData` | Pie — distribution **and** counts | Actively used |
| [CHARTS-09](pie/pie-budget-comparison/charts-api-09-pie-budget-comparison.md) | GET | `/chart/getcomparisonforpie` | `getcomparisonforpie` | `usePieChartQuery` / `getPieComparisonData` | Pie — budget usage | Actively used |

No backend-only routes. No frontend call pointing at a missing endpoint — every function in
`frontend/src/api/chartApi.js` maps to exactly one route above. No legacy or unreachable
routes.

**Reused, not re-documented:** no chart calls an Expense, Budget or Income *endpoint*.
CHARTS-07 and CHARTS-09 read `BudgetModel` directly; the rest read `ExpenseModel` directly.
Those modules are cross-linked from the affected documents rather than duplicated here.

## B. Frontend chart inventory

The full table — every component, its data source, transformation, period support and state
handling — is in charts-consumption-map.md. Summary: **13 chart
surfaces** — 9 visualisations, 1 control, 3 insight cards.

## Documents

| # | Workflow | Level 1 | Level 2 | Document |
|---|---|---|---|---|
| CHARTS-01 | Logged years | [svg](trend/logged-years/charts-api-01-logged-years-overview.svg) | [svg](trend/logged-years/charts-api-01-logged-years-detailed.svg) | [md](trend/logged-years/charts-api-01-logged-years.md) |
| CHARTS-02 | Trend by week | [svg](trend/trend-by-week/charts-api-02-trend-by-week-overview.svg) | [svg](trend/trend-by-week/charts-api-02-trend-by-week-detailed.svg) | [md](trend/trend-by-week/charts-api-02-trend-by-week.md) |
| CHARTS-03 | Trend by month | [svg](trend/trend-by-month/charts-api-03-trend-by-month-overview.svg) | [svg](trend/trend-by-month/charts-api-03-trend-by-month-detailed.svg) | [md](trend/trend-by-month/charts-api-03-trend-by-month.md) |
| CHARTS-04 | Trend by year | [svg](trend/trend-by-year/charts-api-04-trend-by-year-overview.svg) | [svg](trend/trend-by-year/charts-api-04-trend-by-year-detailed.svg) | [md](trend/trend-by-year/charts-api-04-trend-by-year.md) |
| CHARTS-05 | Trend between years | [svg](trend/trend-between-years/charts-api-05-trend-between-years-overview.svg) | [svg](trend/trend-between-years/charts-api-05-trend-between-years-detailed.svg) | [md](trend/trend-between-years/charts-api-05-trend-between-years.md) |
| CHARTS-06 | Bar by category | [svg](bar/bar-by-category/charts-api-06-bar-by-category-overview.svg) | [svg](bar/bar-by-category/charts-api-06-bar-by-category-detailed.svg) | [md](bar/bar-by-category/charts-api-06-bar-by-category.md) |
| CHARTS-07 | Bar budget vs spend | [svg](bar/bar-budget-vs-spend/charts-api-07-bar-budget-vs-spend-overview.svg) | [svg](bar/bar-budget-vs-spend/charts-api-07-bar-budget-vs-spend-detailed.svg) | [md](bar/bar-budget-vs-spend/charts-api-07-bar-budget-vs-spend.md) |
| CHARTS-08 | Pie category | [svg](pie/pie-category/charts-api-08-pie-category-overview.svg) | [svg](pie/pie-category/charts-api-08-pie-category-detailed.svg) | [md](pie/pie-category/charts-api-08-pie-category.md) |
| CHARTS-09 | Pie budget comparison | [svg](pie/pie-budget-comparison/charts-api-09-pie-budget-comparison-overview.svg) | [svg](pie/pie-budget-comparison/charts-api-09-pie-budget-comparison-detailed.svg) | [md](pie/pie-budget-comparison/charts-api-09-pie-budget-comparison.md) |
| FLOW-01 | Chart insights (no API) | [svg](flow/charts-flow-01-chart-insights-overview.svg) | [svg](flow/charts-flow-01-chart-insights-detailed.svg) | [md](flow/charts-flow-01-chart-insights.md) |

Plus the consumption map.

## Structural facts across the module

| | Value |
|---|---|
| Route mount | `app.use("/chart", apiLimiter, chartRouter)` |
| Middleware order | `apiLimiter` → `verifyToken` → controller. **No validation middleware on any chart route** |
| Redis | **Only CHARTS-08 and CHARTS-09.** The other seven read MongoDB on every request |
| Aggregation | MongoDB on CHARTS-01 only; backend JavaScript everywhere else |
| Client cache | TanStack Query, all keys nested under `["charts"]` |
| Ownership | Always scoped by `req.userId` from the token |
| Chart rendering | Entirely frontend (recharts); never appears in a backend region |

## Where the workflows diverge

| | 01 | 02 | 03 | 04 | 05 | 06 | 07 | 08 | 09 |
|---|---|---|---|---|---|---|---|---|---|
| Parameters | — | 2 | 1 | 0 | 1 | 0–1 | 1 | 0–2 | 0 |
| Numeric guard | n/a | **no** | yes | n/a | yes | **no** | **no** | n/a | n/a |
| Redis | no | no | no | no | no | no | no | **yes** | **yes** |
| Date-bounded | n/a | month | year | **none** | span | month/year | n/a | month/year | n/a |
| Reads | expenses | expenses | expenses | expenses | expenses | expenses | **budgets** | expenses | **budgets** |
| Missing periods | n/a | dropped | dropped | n/a | partly kept | n/a | n/a | n/a | n/a |

## Period and date handling — confirmed from code

- Every JavaScript range is built with `new Date(y, m, d)` — **server local time**, inclusive
  end bounds (`23:59:59.999`).
- The single MongoDB aggregation (`CHARTS-01`) uses `$year` with **no timezone argument**, so
  it evaluates in **UTC**. The two conventions disagree at New Year boundaries.
- Month **labels** come from the English `MONTH_NAMES` constant, so they never vary with the
  server locale. Month **keys** in the budget collection do — CHARTS-07 sorts on them and
  CHARTS-09 looks one up with a hardcoded `'en-US'`.
- CHARTS-04 has **no date bound at all**.
- Missing intervals are never zero-filled: CHARTS-03 removes them, CHARTS-02 removes them
  *and* renumbers what is left, CHARTS-05 removes only all-zero rows.
- The current incomplete period is always included; nothing excludes a partial month or year.

## Regenerating

```bash
cd docs/api-workflows/charts
python3 build_charts_overviews.py
python3 build_charts_detailed.py
```

Then rasterise, e.g. `rsvg-convert -w 3200 <name>-overview.svg -o <name>-overview.png` and
`-w 3360` for the detailed views.

## Findings roll-up

Full findings with consequences live in the per-API documents. The five worth reading first,
all verified by running the code:

1. **Weekly labels are positional** (CHARTS-02) — `bucketByWeek` renumbers surviving weeks
   from 1, so "Week 2" can be the fourth calendar week.
2. **Monthly gaps are dropped, not zero-filled** (CHARTS-03) — the line joins January
   straight to April, and the page average is computed over surviving months only.
3. **`year` reaches a `RegExp` unvalidated** (CHARTS-07) — `?year=.*` matches every stored
   month key and returns all years' budgets. Scoped to the caller's own `userId`, so not a
   cross-account disclosure, but unvalidated input in a regex constructor.
4. **CHARTS-09's month key is hardcoded `en-US`** while the budget module writes with the
   server's default locale — on a non-English host the pie can never find a budget.
5. **Budget comparison repair is best effort.** CHARTS-07 and CHARTS-09 call
   `repairIfPending` before reading stored spent values; if repair cannot complete, the
   response retains the existing stored value rather than failing the chart request.
