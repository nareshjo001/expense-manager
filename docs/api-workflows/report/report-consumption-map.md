# Report / Analytics Engine consumption map

What the Reports module actually contains, what it calls, and what internal engine
produces it. Traced from `backend/Routes/report.routes.js` and
`frontend/src/components/monthlyInsights/` outwards.

**The Report is the externally consumed result.** One document, one endpoint, one
frontend hook. **The Analytics Engine is the internal computation pipeline that produces
it** — five Mongo queries, six analyzers, six score calculators, one aggregation, no
HTTP boundary of its own.

## A. Report API inventory

| API ID | Method | Endpoint | Route mount | Backend handler | Frontend caller | Consumer | Status |
|---|---|---|---|---|---|---|---|
| [REPORT-01](report-api-01-get-report.md) | GET | `/report` | `app.use("/report", apiLimiter, reportRoutes)` | `reportController.getReport` | `getReport` in `reportApi.js` | `useReport()` → `MonthlyInsightPage.js` | Actively used |

**That is the entire backend surface.** `report.routes.js` declares one route. There is
no create, update, delete, list, or per-section endpoint — the report is always read as
one whole object, never partially fetched or partially written.

| Operation | Endpoint? |
|---|---|
| Read the report | Yes — REPORT-01 |
| Manual refresh | No — refresh only happens as a side effect of an Expense/Budget mutation (FLOW-02) |
| Create/update/delete | No public endpoint — the document is written only by the engine itself |
| Per-section fetch (e.g. just `financialHealth`) | No — the object is monolithic |

## B. Frontend Report consumption inventory

| UI ID | Page/component | Reads | Network request | State owner | Renders |
|---|---|---|---|---|---|
| R-1 | `MonthlyInsightPage.js` | whole report | `GET /report` (via hook) | `useReport()` | Mounts 4 child sections, each passed a `?? {}`-defaulted slice |
| R-2 | `Header.js` | `summary.*` | none (prop) | — | Total spent, daily average, top category, month-over-month change; owns an unrelated inline budget-edit modal |
| R-3 | `BudgetIntelligence.js` | `budgets`, `budgets.budgetInsights` | none (prop) | — | Utilization bar, one priority-ordered insight message |
| R-4 | `SpendingInsights.js` | `categories.monthly`, `habits.monthly.microSpending`, `habits.monthly.weekendVsWeekday` | none (prop) | — | Top category, micro-spending panel, weekend/weekday panel |
| R-5 | `OverallInsight.js` | `categories.monthly.biggestJump`, `budgets.currentStreak`, `spending.stability.coefficientOfVariation` | none (prop) | — | Spending jump card, streak card, an independently-computed "Stability Score" — see D below |

**Five UI surfaces, one network request.** Every section is a pure prop consumer of the
one `useReport()` result; nothing re-fetches or fetches independently.

| Property | Value |
|---|---|
| Query key | `queryKeys.reports.all` — `["reports"]`, no parameters, one cache entry per user session |
| Client cache | TanStack Query defaults — `staleTime` 5 min, `gcTime` 30 min, `retry` 1, `refetchOnWindowFocus` false |
| Loading state | `<Spinner/>` only — no skeleton, no partial-section render |
| Error state | One message, `"Failed to load report."` — identical text for a network error and a 500 |
| Empty state | Not distinguished from error — `error \|\| !report` is a single branch |
| Manual refresh control | **None** — the page has no refresh button; the report only changes when a mutation elsewhere triggers FLOW-02 |

## C. Analytics Engine component inventory

Every module below is invoked exclusively from `backend/analytics/reportGenerator.js`.
None has an HTTP route of its own.

| Component | File | Function | Inputs | Outputs | Side effects |
|---|---|---|---|---|---|
| Orchestrator | `analytics/reportGenerator.js` | `generateReport(userId)` | `userId` | assembled report object | none — pure orchestration, calls `createAnalyticsContext` then every analyzer |
| Dead duplicate | `analytics/generateReport.js` | `generateReport` (same name, unused) | — | — | **Not required anywhere** — grep-confirmed; contains stale commented-out debug code and a differently-shaped, also-buggy `healthAnalyzer` call |
| Context builder | `analytics/analyticsContext.js` | `createAnalyticsContext(userId)` | `userId` | normalized context (see Table D) | 5 parallel Mongo reads via `Promise.all` |
| Data provider | `analytics/dataProvider.js` | `getCurrentMonthExpenses`, `getPreviousMonthExpenses`, `getCurrentYearExpenses`, `getPreviousYearExpenses`, `getAllBudgets` | date ranges, `userId` | expense/budget arrays | delegates to `fetchExpense` / `fetchBudgets` |
| Analyzer | `analytics/analyzers/spendingAnalyzer.js` | `analyze(currentMonthExpenses, options)` | month's expenses | totals, daily average, weekly coefficient-of-variation stability | none |
| Analyzer | `analytics/analyzers/budgetAnalyzer.js` | `analyze({history, spending, daysInMonth})` | budget history, spending report | utilization, status, streak, linear-projection forecast | none |
| Analyzer | `analytics/analyzers/categoryAnalyzer.js` | `analyze(current, previous)` | expense arrays (run twice: monthly, yearly) | top/least category, distribution, concentration index, growth | none |
| Analyzer | `analytics/analyzers/trendAnalyzer.js` | `analyze({trendData, currentMonthExpenses, previousMonthExpenses})` | trend windows + month arrays | daily/weekly/monthly/quarterly comparisons, direction | none |
| Analyzer | `analytics/analyzers/habitAnalyzer.js` | `analyze(expenses, config)` | expense array (run twice: monthly, yearly) | weekend/weekday split, micro-spending, impulse spending, subscriptions, shopping frequency | none |
| Analyzer | `analytics/analyzers/healthAnalyzer.js` | `analyze({budget, category, spending, trend, habits})` | 5 analyzer outputs | `{scores, overall, dataCompleteness, risk, signals}` | none — **receives `habits` always empty, see Finding F1** |
| Score calculator | `analytics/analyzers/scoreCal/budgetScore.js` | `calculateBudgetScore` | budget report | `{score, normalizedScore, breakdown}` | none |
| Score calculator | `analytics/analyzers/scoreCal/categoryScore.js` | `calculateCategoryScore` | category report | `{score, normalizedScore, breakdown}` | none |
| Score calculator | `analytics/analyzers/scoreCal/spendingScore.js` | `calculateSpendingScore` | spending report | `{score, normalizedScore, breakdown}` | none |
| Score calculator | `analytics/analyzers/scoreCal/trendScore.js` | `calculateTrendScore` | trend report | `{score, normalizedScore, breakdown}` | none |
| Score calculator | `analytics/analyzers/scoreCal/habitScore.js` | `calculateHabitScore` | habit report | `{score, normalizedScore, breakdown}` | none — always computes from a stub given Finding F1 |
| Score calculator | `analytics/analyzers/scoreCal/healthScore.js` | `calculateStabilityScore`, `calculateHealthScore`, `calculateRiskLevel` | all 6 analyzer/score outputs | stability score, weighted overall, risk label | none |
| Insights | `Services/BudgetServices/budgetInsight.service.js` | `generateBudgetInsights(budgetReport)` | budget report | one priority-ordered `{type, title, message, tip}` | none |
| Assembler | `analytics/reportAssembler.js` | `assembleReport({...})` | every analyzer/score output | final report schema (Table below) | none — pure shaping, no I/O |
| Legacy config | `analytics/analyzers/config/scoringRules.js` | — | — | — | **Dead** — different, incomplete weight set than the live `scores/healthRules.js`; nothing requires it |

**Final assembled schema** (`reportAssembler.assembleReport`'s return value — this is the
exact object cached in Redis, persisted in Mongo, and returned to the frontend):

```
{ metadata, summary, spending, budgets, categories: { monthly, yearly },
  trends, habits: { monthly, yearly }, financialHealth, forecast }
```

## D. Data dependency inventory

| Query | File/function | Filter | Range | Notes |
|---|---|---|---|---|
| Current month expenses | `dataProvider.getCurrentMonthExpenses` → `fetchExpense` | `{userId, expenseDate: {$gte, $lte}}` | 1st of month, local midnight, to last day of month | inclusive both ends |
| Previous month expenses | `dataProvider.getPreviousMonthExpenses` | same shape | previous calendar month | |
| Current year expenses | `dataProvider.getCurrentYearExpenses` | same shape | Jan 1 – Dec 31, local | |
| Previous year expenses | `dataProvider.getPreviousYearExpenses` | same shape | prior Jan 1 – Dec 31 | |
| All budgets | `dataProvider.getAllBudgets` → `fetchBudgets` | `{userId}`, projected `{month, budget, spent, _id: 0}` | all months on record | sorted by `MONTH_ORDER` from `chartConstants` |

All five run inside one `Promise.all` in `createAnalyticsContext`. Every query is scoped
by `userId` — no cross-account read path exists anywhere in the engine.

**Analytics Context schema** (`createAnalyticsContext`'s return value):

| Field | Type | Source | Notes |
|---|---|---|---|
| `currentMonthExpenses` | array | query 1 | wrapped in `asArray()` |
| `previousMonthExpenses` | array | query 2 | |
| `currentYearExpenses` | array | query 3 | |
| `previousYearExpenses` | array | query 4 | |
| `budgetHistory` | array | query 5 + derived `currentMonthEntry` | current month's `spent` is independently summed from expenses (`sumExpenses`), **not** read from the Budget document's own `spent` field |
| `trendData` | object | derived, local server time | today/yesterday/week/quarter windows; pools current+previous year before filtering (documented in-code as a year-boundary fix) |
| `daysInMonth` | number | `new Date(y, m+1, 0).getDate()` | |

**Not returned:** `lastExpenseUpdate`, `lastBudgetUpdate` — `reportGenerator.js`
references both via `?? null`, and since the context never sets them, both metadata
fields are always `null` in every generated report.

## E. Cache inventory

| Cache | Key | TTL | Read path | Write path | Failure behaviour |
|---|---|---|---|---|---|
| Redis report cache | `report:<userId>` | 3600 s | `reportService.getReport` — checked first | `reportService.getReport` (after Mongo fallback or engine run) and `refreshReport` | `get`'s `JSON.parse` is inside the same try/catch as the Redis call — a corrupted value degrades to a cache miss, not a crash; any Redis error is caught and swallowed everywhere it's touched |
| Mongo `FinancialReport` | `{user: userId}`, unique | none (persistent) | `getReport` on a Redis miss — served **as-is**, not recomputed | `findOneAndUpdate(... upsert: true)` in both `getReport` (on a true miss) and `refreshReport` | no transaction; the upsert always runs |
| TanStack Query client cache | `["reports"]` | staleTime 5 min / gcTime 30 min | `useReport()` | invalidated by every Expense/Budget mutation's `onSuccess`, and — harmlessly — by Income mutations too | `retry: 1`, no background refetch on focus |

No cache-stampede protection exists at any layer: concurrent cache-miss computations or
concurrent `refreshReport` calls for the same user each run their own full recompute and
each overwrite Mongo/Redis independently.

## F. Cross-links to existing module documentation

| Report touches | Nature | Documented in |
|---|---|---|
| `ExpenseModel` | Read-only, 4 date-ranged queries per report | [Expense set](../expense/README.md) |
| `BudgetModel` | Read-only, all-months query | [Budget set](../budget/README.md) |
| `IncomeModel` | **Never read** — confirmed absent from `dataProvider.js` and `analyticsContext.js` | [Income set](../income/README.md) — income mutations invalidate `reports.all` anyway (a harmless no-op refetch) |
| `chartConstants.MONTH_ORDER` | Shared sort order for budget history | [Charts set](../charts/README.md) |
| Expense mutations (add/edit/delete) | Call `refreshReport` synchronously — see [FLOW-02](report-flow-02-mutation-refresh.md) | [Expense API-05/06/07](../expense/README.md) |
| Budget mutations (set/update) | Call `refreshReport` synchronously — see [FLOW-02](report-flow-02-mutation-refresh.md) | [Budget BUDGET-02/03](../budget/README.md) |
| `cron/recurringJob.js` | Also calls `refreshReport` — a sixth, non-HTTP trigger | not yet part of this module's scope; noted here as a caller only |
| ML Service / SIA | **Not called anywhere in this module** — confirmed by tracing every analyzer and score calculator; no HTTP client, no queue, no model artifact referenced | out of scope, stated explicitly rather than diagrammed |

## G. Layers that do not exist

Stated explicitly because their absence is part of the module's actual shape:

- No per-section report endpoint — the object is always read or written whole
- No manual "refresh my report" UI control
- No ML or SIA call anywhere in the generation pipeline
- No budget-cache layer (Budget has none either — consistent with the Budget module)
- No cache-stampede lock or request coalescing
- No transaction wrapping the Mongo upsert and the Redis write
- No per-analyzer error isolation — one analyzer throwing aborts the entire engine run
