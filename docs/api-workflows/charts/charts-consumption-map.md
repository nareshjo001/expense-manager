# Charts consumption map

Which chart reads which endpoint, what transforms the data, and where the shared paths are.
Traced from `backend/Routes/chart.routes.js` and the three chart pages outwards.

## A. Every chart component, and where its data comes from

| Chart ID | Chart / component | Page | Data source | Transformation | Period / filter | State handling |
|---|---|---|---|---|---|---|
| C-1 | Line — weekly | `/chart/line` | [CHARTS-02](charts-api-02-trend-by-week.md) | `bucketByWeek`, relabelled `Week 1..N` | month picker (`YYYY-MM`) | Own query; local `viewBy`, `selectedMonthYear` |
| C-2 | Line — monthly | `/chart/line` | [CHARTS-03](charts-api-03-trend-by-month.md) | `monthlyTotals`, zero months **dropped** | year input (4 chars) | Own query; local `selectedYear` |
| C-3 | Line — yearly | `/chart/line` | [CHARTS-04](charts-api-04-trend-by-year.md) | `groupByYear`, never sorted | none | Own query |
| C-4 | Multi-line — year comparison | `/chart/line` | [CHARTS-05](charts-api-05-trend-between-years.md) | month × year grid, all-zero rows dropped | multi-select of years | Own query; local `selectedYears` |
| C-5 | Bar — by category | `/chart/bar` | [CHARTS-06](charts-api-06-bar-by-category.md) | `categoryTotals`, unsorted | optional month, else current year | Own query; local `specificMonth` |
| C-6 | Bar — budget vs spend | `/chart/bar` | [CHARTS-07](charts-api-07-bar-budget-vs-spend.md) | rename `spent`→`total`, sort by `MONTH_ORDER` | year input | Own query |
| C-7 | Pie — distribution | `/chart/pie` | [CHARTS-08](charts-api-08-pie-category.md) `type=total` | `categoryTotals`; % computed by recharts | This Month / This Year | Own query; local `show`, `viewBy` |
| C-8 | Pie — counts | `/chart/pie` | [CHARTS-08](charts-api-08-pie-category.md) `type=count` | `categoryCounts` into the same `total` field | This Month / This Year | Same query hook, different `type` |
| C-9 | Pie — budget usage | `/chart/pie` | [CHARTS-09](charts-api-09-pie-budget-comparison.md) | `Math.max(0, budget − spent)` | none — always current month | Own query |
| S-1 | Year multi-select (control) | `/chart/line` | [CHARTS-01](charts-api-01-logged-years.md) | `map(y => y._id)` | none | Own query; feeds C-4 |
| I-1 | Inline insight — line | `/chart/line` | **No API** — reuses C-1/C-2/C-3 | [FLOW-01](charts-flow-01-chart-insights.md) | follows the chart | React Context |
| I-2 | Inline insight — bar | `/chart/bar` | **No API** — reuses C-5/C-6 | [FLOW-01](charts-flow-01-chart-insights.md) | follows the chart | React Context |
| I-3 | Inline insight — pie | `/chart/pie` | **No API** — reuses C-7/C-8/C-9 | [FLOW-01](charts-flow-01-chart-insights.md) | follows the chart | React Context |

**13 chart surfaces** — 9 visualisations, 1 control, 3 insight cards.

## B. Fan-out — one response feeding more than one consumer

Every chart response is read **twice**: once by the chart wrapper and once by the insight
flow. They are independent readers of the same TanStack cache entry; neither copies or
mutates it.

```
CHARTS-02..09 response
        ├── chart wrapper   (recharts)
        └── notifyChartFilterApplied → ChartInsightsContext → InlineChartInsight
```

One endpoint also serves two *charts*:

```
CHARTS-08  ──type=total──> C-7 Pie distribution
           ──type=count──> C-8 Pie counts        (same hook, same key shape, different type)
```

## C. Fan-in — is any chart built from more than one request?

**No chart combines two API responses.** Two near-misses worth stating explicitly, because
both look like joins and are not:

- **C-6 budget vs spend** plots two series, but both arrive in one response. `budget` and
  `spent` are two fields on the *same* budget document. Neither the backend nor the frontend
  joins expenses into it.
- **`/chart/line`** runs two queries — CHARTS-01 for the year selector and one CHARTS-02/03/04/05
  for the chart. They are independent: one populates a control, the other the visualisation.
  Their loading and error states are separate, and neither is joined to the other.

Because there is no multi-source chart, no combined-data workflow document was created.

## D. Shared backend implementation

| Shared unit | Used by | Diverges at |
|---|---|---|
| `getCategoryBreakdown` | CHARTS-06, CHARTS-08 | Range resolution and `type`; only CHARTS-08 caches |
| `getBudgetComparison` | CHARTS-07 (`mode:'year'`), CHARTS-09 (`mode:'month'`) | Year mode returns an array by regex; month mode returns one clamped pair |
| `fetchExpense` | CHARTS-02, 03, 05, 06, 08 | The range passed in |
| `bucketByWeek` | CHARTS-02 (`weekNumber`), and API-01 in the expense module (`date`) | The `labelType` option |
| `chartRangeResolver` | CHARTS-02, 03, 05, 06, 08 | Which resolver is called |
| `MONTH_NAMES` / `MONTH_ORDER` | CHARTS-03, 05, 07, and budget's `sortByMonthKey` | Labelling vs sorting |

## E. Where aggregation actually happens

| Location | Routes |
|---|---|
| **MongoDB** | CHARTS-01 only (`$group` on `$year`) |
| **Backend JavaScript** | CHARTS-02, 03, 04, 05, 06, 08 — documents are fetched, then grouped in Node |
| **Backend, no aggregation** | CHARTS-07, 09 — budget rows are read and mapped |
| **Frontend** | Only the page-level average line in `TrendChartPage`, and the slice percentages recharts computes |
| **Chart component** | Percentages in `PieChartWrapper` (via recharts `percent`) |

## F. Cross-module dependencies

| Chart route | Depends on | Nature |
|---|---|---|
| CHARTS-07 | `BudgetModel` | Reads budget rows written by [BUDGET-02](../budget/budget-api-02-set-budget.md) / [BUDGET-03](../budget/budget-api-03-update-budget.md). Does **not** call those endpoints |
| CHARTS-09 | `BudgetModel` | Same, for one month |
| CHARTS-02/03/05/06/08 | `ExpenseModel` | Read directly through `fetchExpense`; the expense endpoints are not called |
| CHARTS-08/09 | `utils/expenseCache` | Share the per-user key registry that expense mutations drain |

No chart calls an Expense, Budget or Income **endpoint**. They read the same collections
directly, so those modules' API documents are cross-referenced rather than duplicated.

## G. Invalidation reachability

`queryKeys.charts.all` is `["charts"]`, and every chart key nests beneath it, so a single
`invalidateQueries({ queryKey: queryKeys.charts.all })` reaches all nine.

| Mutation | Invalidates `["charts"]`? | Clears the Redis pie keys? |
|---|---|---|
| Add / edit / delete expense | Yes | Yes — via `clearUserExpenseCache` |
| Set / update budget | Yes | **No** — budget writes never call `clearUserExpenseCache` |
| Add / edit / delete income | No | No |

The middle row is the one live staleness path in this module: after a budget change the
client refetches, but CHARTS-09 answers from a Redis entry that is up to 300 s old. Income
mutations correctly do not touch chart keys, because no chart reads income.
