# BALENISA Chart Architecture — Final Review Before Freeze

Review-only audit. No code was modified to produce this report.

---

## 1. Controller Layer Review

All 9 endpoints were re-read in full against source. Results:

| Controller | Thin? | Remaining logic in controller |
|---|---|---|
| `getloggedyears.js` | No (by design) | Direct `ExpenseModel.aggregate` — intentional exception, see §7 |
| `linechartbyweek.js` | Yes | Param presence check only |
| `linechartbymonth.js` | Yes | `Number()` + `isNaN` check only |
| `linechartbyyear.js` | Yes | None |
| `linechartbetweenyears.js` | Yes | CSV-to-number-array parse + `isNaN` check (request parsing, not business logic) |
| `barchartbycategory.js` | Yes | Chooses *which* resolver to call (`resolveMonthRange` vs `resolveCurrentYearRange`) based on query param presence — a routing decision, not date math itself |
| `barchartbymonth.js` | Yes | Post-fetch display formatting: `month.split(' ')[0]` and chronological sort — explicitly kept here since Phase 4 (chart-specific display shaping, not shared logic) |
| `getPieCategoryData.js` | Yes | Same resolver-selection pattern as `barchartbycategory.js`; cache check/set |
| `getcomparisonforpie.js` | Yes | Derives the current month's **string key** (`"Feb 2026"`) via `toLocaleString` — required because `BudgetModel.month` is a string, not a Date, so `chartRangeResolver` doesn't apply here (Phase 4 finding, still valid); cache check/set |

No direct Model imports, no inline date-range math (`new Date(...)` range construction), and no duplicated aggregation/grouping transforms remain in any of the 8 chart-transformation controllers. `getloggedyears.js` is the one deliberate exception (§7).

---

## 2. Chart Service Review

`chart.service.js` exports:

```
groupByYear, monthlyTotals, categoryTotals, categoryCounts,
getCategoryBreakdown, getBudgetComparison,
getMonthlyLineChart, getWeeklyLineChart,
getMultiYearLineChart, getYearlyLineChart
```

Cross-checked against the checklist's expected list:

| Expected | Present as | Note |
|---|---|---|
| `getWeeklyLineChart()` | ✅ exact match | |
| `getMonthlyLineChart()` | ✅ exact match | |
| `getYearlyLineChart()` | ✅ exact match | |
| `getMultiYearLineChart()` | ✅ exact match | |
| `getCategoryBreakdown()` | ✅ exact match | |
| `getBudgetComparison()` | ✅ exact match | |
| `getBudgetVsSpentByMonth()` | ⚠️ not present under this name | Functionality lives in `getBudgetComparison({mode: 'year'})`, which is what `barchartbymonth.js` actually calls. This was an explicit Phase 4 naming decision ("equivalent design if a better name/signature fits" was permitted) — one function handles both the month-mode and year-mode budget lookups rather than splitting into two. Not a gap, a naming difference. |

Shared helpers are reused correctly: `groupByCategoryHelper`/`bucketByWeek` (from `getexpense.service.js`), `monthNames`/`MONTH_ORDER` (from `chartConstants.js`, single source), the six `chartRangeResolver.js` functions. No duplicate grouping/aggregation logic exists across the chart controllers. No duplicate month-name arrays remain *within chart scope* — the one duplicate found outside chart scope in Phase 1 (`analytics/analyticsContext.js`) is unrelated to this subsystem and was never in scope for this migration.

---

## 3. Date Range Review

| Resolver function | Used by |
|---|---|
| `resolveMonthRange` | `barchartbycategory` (month branch), `getWeeklyLineChart` |
| `resolveYearRange` | `getPieCategoryData` (year branch), `getMonthlyLineChart` |
| `resolveCurrentMonthRange` | `getPieCategoryData` (default branch) |
| `resolveCurrentYearRange` | `barchartbycategory` (default branch) |
| `resolveMultiYearRange` | `getMultiYearLineChart` |
| `resolveAllTime` | **unused** — see below |

All charts that filter expenses by a date range go through the resolver — zero inline `new Date(...)` range math remains in any chart controller or service function. Boundaries are `00:00:00.000` (start) to `23:59:59.999` (end), server-local time zone throughout, documented in the resolver's file header. Leap-year February is handled correctly for free: `new Date(year, month, 0, ...)` is JS's native "day 0 of next month = last day of this month" trick, which already accounts for Feb 28/29 automatically — no special-casing needed or present.

`resolveAllTime()` exists but has no caller. Both all-time endpoints (`getYearlyLineChart`, `getloggedyears`) bypass it deliberately: `fetchExpense` has no unbounded-query branch (adding one was explicitly out of scope for Phase 5.4, since it's used by every other endpoint and changing it wasn't authorized), and `getloggedyears` never calls `fetchExpense` at all — it aggregates directly. This isn't a defect; it's an intentionally orphaned utility. Worth a note for whenever `fetchExpense` itself is revisited, not an action item now.

Budget comparison (`getBudgetComparison`) intentionally does not use `chartRangeResolver` — `BudgetModel.month` is a `String` field ("Jan 2026"), not a Date, so range resolution doesn't apply. This was established and documented in Phase 4 and remains correct.

---

## 4. Data Access Review

```
Controller → Chart Service → fetchExpense / BudgetModel / ExpenseModel → MongoDB
```

There is no separate repository/data-access file in this codebase (confirmed in the original architecture audit) — `chart.service.js` importing `BudgetModel`/`ExpenseModel` directly, and `fetchExpenses.js` importing `ExpenseModel` directly, **is** the data access layer by this codebase's existing convention, not a violation of it.

Remaining direct Model usage outside that expected layer:

- `getloggedyears.js` calls `ExpenseModel.aggregate(...)` directly from the controller — the one place a controller talks to MongoDB directly. Intentional (§7).
- Every controller imports `UserModel` for the `await UserModel.findById(req.userId)` auth guard. This is the pre-existing, codebase-wide auth-check pattern (used identically in the frozen Budget controllers) — not chart/expense business logic, so it doesn't count against "no direct Model usage" in the sense the checklist means.

No controller bypasses the Chart Service for actual chart data (category totals, budget comparisons, line/bar/pie series).

---

## 5. Response Contract Audit

| Endpoint | Response Shape | Changed? |
|---|---|---|
| `GET /getloggedyears` | `{ success, data: [year, ...] }` | No |
| `GET /linechartbyweek` | `{ success, data: [{ week, total }] }` | No |
| `GET /linechartbymonth` | `{ success, data: [{ month, total }] }` | No |
| `GET /linechartbyyear` | `{ success, data: [{ year, total }] }` | No |
| `GET /linechartbetweenyears` | `{ success, data: [{ month, <year1>: total, <year2>: total, ... }] }` | No |
| `GET /barchartbycategory` | `{ success, data: [{ category, total }] }` | No |
| `GET /barchartbymonth` | `{ success, data: [{ month, budget, total }] }` (chronologically sorted) | No |
| `GET /getPieCategoryData` | `{ success, data: [{ category, total }] }` (+ `message: "Success (cached)"` on cache hit) | No |
| `GET /getcomparisonforpie` | No budget: `[{category:"Budget",total:0},{category:"Spent",total:0}]`. Budget exists: `[{category:"Remaining",total},{category:"Spent",total}]` (+ `message` on cache hit) | No |

Every field name, error shape (`{message, success:false}` / HTTP 401 / 400 / 500), and empty-state shape was preserved verbatim across all five migration phases — each phase's own verification step confirmed this individually. Frontend compatibility is intact.

---

## 6. Edge Case Review

**Expense charts**

- No expenses → every endpoint returns `[]` (either via an explicit short-circuit preserved from the original, e.g. `getMonthlyLineChart`/`getMultiYearLineChart`, or naturally, since `Object.entries({})`/empty-array `reduce` already resolve to `[]`/`{}` with nothing to iterate).
- One expense / multiple categories → all grouping functions use `Object.entries` and `reduce`/`forEach`, which scale to any count without special-casing; no issues.
- Month-boundary expense → the two disclosed, ~1-second-or-less precision differences (`barchartbycategory` month branch, `linechartbyweek`) were tested with synthetic boundary data during their respective phases; both are widenings from the original (never a narrowing), and both were confirmed inconsequential for real expense timestamps.
- Year-boundary expense → `resolveYearRange`/`resolveMultiYearRange` were verified byte-identical to the original inline math in Phase 2; a synthetic Dec 31 23:59:59.999 expense was tested in Phase 5.3 and matched old vs. new exactly. `linechartbyyear`/`getloggedyears` don't filter by range at all (all-time), so a year boundary is purely a `getYear()`/`$year` grouping question, unaffected by range logic.
- Leap year February → handled automatically by the Date constructor's day-0 trick (§3); this was already relied upon before the migration, unchanged.

**Budget charts**

- No budget exists → `mode:'month'` returns `null` → `getcomparisonforpie` takes its explicit zero-value branch (not cached, matching the original's early-return-before-cache behavior). `mode:'year'` returns `[]` from `.find()` → `barchartbymonth` returns `[]`.
- `budget = 0` → `remaining = Math.max(0, 0 - spent) = 0` whenever `spent >= 0`. Consistent, unchanged.
- `spent` missing → `remaining = Math.max(0, budget - undefined) = Math.max(0, NaN) = NaN → Number(NaN)||0 → 0`. So a document missing `spent` yields `remaining: 0`, not `remaining: budget` — this is the original's exact (arguably surprising) behavior, deliberately preserved in Phase 4 rather than "fixed," per that phase's explicit instructions. In practice this is unreachable through the app today since `BudgetModel.spent` is schema-`required: true`; flagging as a known, dormant, pre-existing quirk rather than a live bug.
- Overspending (`spent > budget`) → `remaining` clamps to `0`, never negative. Unchanged.
- Missing months (year mode) → `barchartbymonth`'s result array simply omits months with no budget doc (no zero-filled placeholder). This is the original query's behavior (`.find()` only returns what exists), not something the migration introduced — noting it here because a pre-freeze audit is exactly the place to surface it, in case the frontend assumes a dense 12-entry array.

---

## 7. Known Intentional Decisions Review

- **Category chart defaults** — confirmed still asymmetric: `barchartbycategory` defaults to current year (`resolveCurrentYearRange`), `getPieCategoryData` defaults to current month (`resolveCurrentMonthRange`). Not unified. Matches your instruction.
- **Pie comparison labels** — confirmed preserved exactly: `Budget`/`Spent` (zero-state) vs. `Remaining`/`Spent` (budget exists). Not normalized.
- **`getloggedyears` outside Chart Service** — confirmed. It performs its own `$year`-grouping aggregation directly against `ExpenseModel`, never calls into `chart.service.js`. This is a metadata lookup (which years have any data at all, for populating a year picker) rather than a chart data transformation, so it staying outside the Chart Service is consistent with the target architecture's intent, not an oversight.

---

## 8. Caching Decision Review

**Current state:** only 2 of 9 endpoints cache — `getPieCategoryData` and `getcomparisonforpie`, both via `utils/expenseCache.js` (Redis, 300s TTL, per-user tracked key-set, atomic MULTI/EXEC writes, best-effort/fail-open on Redis errors). The other 7 endpoints hit MongoDB on every request.

**A finding relevant to this decision:** cache invalidation (`clearUserExpenseCache`) is wired into `addexpense.js`, `editExpense.js`, and `deleteExpense.js`, but **not** into either Budget mutation controller (`setbudget.js`, `updatebudget.js`). That means `getcomparisonforpie`'s cache entry can serve a stale budget-vs-spent comparison for up to 5 minutes after a user changes their budget — expense-driven invalidation is correct, budget-driven invalidation is missing. This predates the chart migration and lives in the (currently frozen) Budget controllers, so it's out of scope to fix here, but it directly bears on whether to expand caching now.

**Recommendation: B — Freeze charts first, add caching later.**

Reasoning: at BALENISA's current scale, 7 of 9 endpoints run uncached today with no reported latency problem — there's no demonstrated need driving a caching expansion right now. Adding caching to more endpoints means wiring correct invalidation across every expense **and** budget mutation path for each; the one gap just found (budget mutations not invalidating the pie-comparison cache) shows that even the existing, narrower caching surface isn't fully wired correctly yet. Expanding caching before fixing that would just extend the same class of bug into more endpoints. Once charts are frozen, decide caching from real observed load, and fix the existing invalidation gap as its own, separately-scoped Budget-module change.

---

## Chart Review Result

### Architecture Status: PASS

### Endpoint Status Table

| Endpoint | Status | Notes |
|---|---|---|
| `GET /getloggedyears` | PASS (intentional exception) | Bypasses Chart Service by design — metadata endpoint |
| `GET /linechartbyweek` | PASS | Disclosed ~999ms boundary widening, inconsequential |
| `GET /linechartbymonth` | PASS | Zero-risk migration, byte-identical range math |
| `GET /linechartbyyear` | PASS | Pure relocation, no logic change |
| `GET /linechartbetweenyears` | PASS | Byte-identical range math, verified |
| `GET /barchartbycategory` | PASS | Range-resolver adoption also fixed a real ~24h under-inclusion bug (byproduct of Phase 3) |
| `GET /barchartbymonth` | PASS | Year-mode budget regex query — see Remaining Issues |
| `GET /getPieCategoryData` | PASS | Cache invalidation correct (expense mutations) |
| `GET /getcomparisonforpie` | PASS, with a caveat | Cache invalidation gap on budget mutations — see Remaining Issues |

### Remaining Issues

1. **Regex construction from unsanitized query input in `getBudgetComparison({mode:'year'})`.** `barchartbymonth.js` passes `req.query.year` straight through (no `Number()` conversion, no format validation beyond truthiness) into `new RegExp(year + '$', 'i')`. A crafted `year` value could trigger catastrophic-backtracking (ReDoS) or simply an unexpected match pattern. It can't leak cross-user data (the query is still scoped by `userId`), but it's unvalidated user input reaching `RegExp` construction. This predates the chart migration — Phase 4 preserved it as-is per the "exact original behavior" mandate — but a pre-freeze audit should surface it now.
2. **Cache invalidation gap:** Budget mutations (`setbudget`, `updatebudget`) don't call `clearUserExpenseCache`, so `getcomparisonforpie`'s cache can be stale for up to 5 minutes after a budget change. Lives in the frozen Budget module; noted here because it directly affects a chart endpoint's correctness.
3. **`resolveAllTime()` is unused.** Not a bug, just an orphaned export — worth remembering if `fetchExpense` is ever extended to support unbounded queries.

Neither issue requires touching the chart architecture itself — both are one-line fixes that live in Budget-module or param-validation territory, i.e. explicitly out of this phase's scope.

### Intentional Deviations

- `getloggedyears` bypasses the Chart Service (metadata endpoint, not a transformation).
- `getBudgetComparison` bypasses `chartRangeResolver` entirely (Budget uses string month-keys, not Date ranges).
- `barchartbycategory` defaults to current-year; `getPieCategoryData` defaults to current-month — not unified.
- Pie comparison label asymmetry (`Budget`/`Spent` vs. `Remaining`/`Spent`) preserved, not normalized.
- `getYearlyLineChart` bypasses `fetchExpense`/`resolveAllTime`, using a direct `ExpenseModel.find` — original behavior preserved rather than extending `fetchExpense`'s contract.
- Missing-`spent` → `remaining: 0` (not `remaining: budget`) — preserved original arithmetic ordering, functionally dormant due to schema `required: true` on `spent`.

### Caching Recommendation

**B — Freeze charts first, add caching later**, driven by real load data once frozen. See §8 for the invalidation gap that argues against expanding caching surface right now.

### Freeze Recommendation

**Freeze Charts v1.** All 9 endpoints are architecturally consistent with the target design, every response contract is verified unchanged, and the two real issues found (regex input validation, budget-cache invalidation) are both narrowly-scoped, separately-fixable items outside the chart subsystem — neither blocks freezing the chart architecture itself.
