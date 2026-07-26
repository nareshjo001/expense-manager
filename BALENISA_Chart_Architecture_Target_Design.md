# BALENISA Chart Architecture — Target Design

Design-only deliverable. No code has been written, modified, or moved. This builds directly on `BALENISA_Chart_Architecture_Audit.md` — every duplication, inconsistency, and endpoint listed there is addressed explicitly below, with a note on how each is resolved (or deliberately left alone, and why).

---

## 1. Design Goals

In priority order, since some of these trade off against each other:

1. **Zero frontend breakage.** `TrendChartPage.js`, `BarChartPage.js`, `PieChartPage.js` keep calling the exact same 9 URLs with the exact same query parameters and get back the exact same response shapes they get today, unless a shape is explicitly called out below as a proposed (opt-in, separately-staged) breaking change.
2. **One implementation per piece of logic.** Date-range resolution, category grouping, and month-based totals each get exactly one implementation, called from wherever they're needed — not one implementation reused inconsistently plus several bespoke reimplementations, which is today's actual state.
3. **Make the expense-derived vs. budget-derived split explicit**, not something you only discover by reading each controller's imports.
4. **Keep the door open for later API-surface changes (Option A/B from the audit) without re-doing this work.** Whatever sits behind the routes should be equally usable by today's 9 routes or by a future unified `/charts` endpoint, so that decision stays genuinely deferred rather than accidentally foreclosed by this design.
5. **Isolate the one real scaling risk** (in-memory JS aggregation instead of MongoDB `$group`) behind an interface, so it can be improved later without touching anything above it.

---

## 2. Target Layered Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Routes (Routes/api.routes.js)                                  │
│  — unchanged: same 9 routes, same paths, same verifyToken guard │
└───────────────────────────────┬───────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  Controllers (LineChart / BarChart / PieChart — thin)           │
│  — parse req.query, call one Chart Service function,            │
│    shape the HTTP response. No date math. No DB calls.          │
│    No grouping/summing logic.                                   │
└───────────────────────────────┬───────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  Chart Service (Services/ChartServices/)                        │
│  — one function per current endpoint's *logic*                  │
│  — resolves date ranges via the shared Range Resolver           │
│  — calls the Data Access layer, then applies one of a small     │
│    set of shared transforms (category totals/counts,            │
│    monthly totals, weekly buckets, yearly totals)                │
└───────────────────────────────┬───────────────────────────────────┘
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  Data Access (fetchExpense / fetchBudgets — promoted, not new)  │
│  — the ONLY code that touches ExpenseModel / BudgetModel        │
│    for chart purposes                                            │
└───────────────────────────────┬───────────────────────────────────┘
                                 ▼
                            MongoDB
```

This is not a new shape invented from scratch — it's the audit's finding that ~half of this already exists (`fetchExpense`, `chart.service.js`, `getexpense.service.js`, `datecal.service.js`) made **mandatory** instead of optional, plus the two pieces that don't exist yet: a single Range Resolver and an explicit Chart Service function per endpoint.

---

## 3. New Shared Components

Two genuinely new pieces, both small and single-purpose. Shown as interface sketches (name, inputs, output shape) to communicate the contract — not implementations.

### 3.1 Range Resolver — `Services/ChartServices/chartRangeResolver.js` *(new)*

Replaces the 5+ independent inline date-range calculations found in the audit (`linechartbyweek`, `linechartbymonth`, `barchartbycategory`'s two branches, `getPieDateRange`'s two branches) with one function per **granularity concept**, each returning `{ startDate, endDate }` (or `null` for "no bound"):

| Function | Replaces inline logic currently in |
|---|---|
| `resolveMonthRange(year, month)` | `linechartbyweek`, `barchartbycategory`'s month-branch |
| `resolveYearRange(year)` | `linechartbymonth`, `barchartbycategory`'s year-default-branch, `getPieDateRange`'s year-branch |
| `resolveCurrentMonthRange()` | `getPieDateRange`'s no-year-branch |
| `resolveCurrentYearRange()` | `barchartbycategory`'s no-month-branch (this is the "inconsistent default" the audit flagged — see §6) |
| `resolveMultiYearRange(years[])` | `linechartbetweenyears` |
| `resolveAllTime()` | `linechartbyyear` — returns `null`, signaling "no filter," so the caller and the Data Access layer both handle "no bound" as a real, named case instead of `linechartbyyear` silently skipping range logic entirely the way it does today |

`datecal.service.js`'s existing `getMonthRange`, `getLastWeekQueryDates`, and `getPieDateRange` either get absorbed into this module or this module becomes a thin wrapper around them — that's an implementation detail to settle at build time, not a design decision that changes any behavior.

### 3.2 Shared Constants — `Services/ChartServices/chartConstants.js` *(new)*

```
MONTH_NAMES = ['Jan', 'Feb', ..., 'Dec']
MONTH_ORDER = MONTH_NAMES   // barchartbymonth's separately-named copy becomes an alias, not a second array
```
One export, three current call sites (`chart.service.js`, `linechartbetweenyears.js`, `barchartbymonth.js`) import it instead of each declaring their own copy.

### 3.3 Everything else is promotion, not invention

- `groupByCategoryHelper`, `categoryTotals`, `categoryCounts`, `monthlyTotals`, `groupByYear`, `bucketByWeek` — all already exist in `chart.service.js`/`getexpense.service.js`. They move from "called by some controllers" to "the only path any Chart Service function uses" — no interface changes needed.
- `fetchExpense`/`fetchBudgets` — already exist. `linechartbyyear`'s direct `ExpenseModel.find` and `barchartbymonth`/`getcomparisonforpie`'s direct `BudgetModel` queries move behind these, closing the "bypasses the data layer" gaps the audit flagged. `fetchExpense` needs one small contract extension: accepting `null`/absent bounds to mean "no filter" (for `linechartbyyear`'s use case), which is additive, not a breaking change to its 5 existing callers.

---

## 4. Per-Endpoint Mapping — Proof Nothing Breaks

Every current endpoint, its route, its params, and its response shape stay identical. Only *where the logic lives* changes.

| Endpoint (route unchanged) | Chart Service function *(new, thin)* | Data Access call | Transform used | Response shape |
|---|---|---|---|---|
| `GET /getloggedyears` | *(unchanged — stays a direct aggregation, see §7)* | `ExpenseModel.aggregate` | — | `{success, data:[years]}` — unchanged |
| `GET /linechartbyweek` | `getWeeklyLineChart(userId, year, month)` | `fetchExpense(resolveMonthRange(...))` | `bucketByWeek` | `{success, data:[{week,total}]}` — unchanged |
| `GET /linechartbymonth` | `getMonthlyLineChart(userId, year)` | `fetchExpense(resolveYearRange(...))` | `monthlyTotals` | `{success, data:[{month,total}]}` — unchanged |
| `GET /linechartbyyear` | `getYearlyLineChart(userId)` | `fetchExpense(resolveAllTime())` — now routed through the shared fetch instead of a direct model query | `groupByYear` | `{success, data:[{year,total}]}` — unchanged |
| `GET /linechartbetweenyears` | `getMultiYearLineChart(userId, years[])` | `fetchExpense(resolveMultiYearRange(...))` | `monthlyTotals` parameterized per year, replacing the bespoke inline loop | `{success, data:[{month, <year>: total, ...}]}` — unchanged |
| `GET /barchartbycategory` | `getCategoryBarChart(userId, month?)` | `fetchExpense(resolveMonthRange(...) or resolveCurrentYearRange())` | `groupByCategoryHelper` → `categoryTotals` | `{success, data:[{category,total}]}` — unchanged |
| `GET /barchartbymonth` | `getBudgetVsSpentByMonth(userId, year)` | `fetchBudgets` (year-filtered), now the same data-access primitive `barchartbymonth` should have been using instead of an ad-hoc `BudgetModel.find` + regex | — (map/sort as today) | `{success, data:[{month,budget,total}]}` — unchanged |
| `GET /getPieCategoryData` | `getCategoryPieChart(userId, year?, type)` | `fetchExpense(resolveYearRange(...) or resolveCurrentMonthRange())` | `groupByCategoryHelper` → `categoryTotals`/`categoryCounts` — **same function as `getCategoryBarChart` above** | `{success, data:[{category,total}]}` — unchanged |
| `GET /getcomparisonforpie` | `getBudgetVsSpentForMonth(userId, month?)` | `fetchBudgets`/`BudgetModel.findOne`, single-month variant of the same function `getBudgetVsSpentByMonth` calls internally | — | `{success, data:[{category,total}]}` — unchanged |

The two duplication pairs the audit identified (`barchartbycategory` ↔ `getPieCategoryData`, `barchartbymonth` ↔ `getcomparisonforpie`) now literally call the same Chart Service function (or the same function with a narrower range), instead of independently reimplementing the same logic. Each still has its own thin controller and its own route — the duplication is resolved at the logic layer without touching the API surface at all.

---

## 5. API Surface Decision

The audit deliberately left Option A (9+ discrete routes) vs. Option B (single `/charts` endpoint) as an open tradeoff. For this target design, I'm recommending a specific choice, since a design needs one to be concrete — **keep the 9 existing routes (Option A), backed entirely by the shared Chart Service layer above.**

Reasoning:
- The audit's actual complexity findings (duplicated date math, duplicated grouping logic, inconsistent defaults, inconsistent caching) live at the **logic layer**, not the **routing layer**. Collapsing 9 routes into 1 wouldn't have fixed any of them on its own — the Chart Service layer does, independent of how many URLs sit in front of it.
- Each of the 3 frontend pages (`TrendChartPage`, `BarChartPage`, `PieChartPage`) already owns a fixed, small set of related endpoints and picks between them internally — there's no evidence of a cross-page need to compose chart types dynamically that would justify a generic `{type, filter, range}` endpoint today.
- **This choice is not a dead end for Option B.** Because every endpoint now routes through a Chart Service function with a stable signature, a future `POST /charts` endpoint could be added later as a thin dispatcher over the *same* Chart Service functions, with zero duplication cost and no rework of this layer. Deferring the route-count decision stays genuinely possible, not just theoretically possible.

---

## 6. Explicit Decisions on the Audit's Open Questions

Two things the audit flagged as inconsistencies need an explicit decision in a target design, not just a shared implementation:

**Default range for "category breakdown, no explicit period given"** — `barchartbycategory` defaults to the current year; `getPieCategoryData` defaults to the current month. Under the shared Range Resolver, this asymmetry becomes a *visible, named* choice (`resolveCurrentYearRange()` vs. `resolveCurrentMonthRange()` called explicitly by each Chart Service function) rather than something buried in two different files' inline math. I'm not proposing to unify the two defaults — bar and pie charts plausibly want different default zoom levels for good UX reasons — but the design makes the difference a one-line, auditable decision instead of an accidental divergence.

**`{category, total}` field reuse in `getcomparisonforpie`** for non-category data (`Remaining`/`Spent` labels) — left as-is for this design, since fixing it would change response content, which violates goal #1 (zero frontend breakage) unless staged as an explicit, separately-approved breaking change. Flagging it here so it isn't silently carried forward as an oversight rather than a decision.

---

## 7. What Deliberately Does Not Move Into This Layering

- **`getloggedyears`** stays exactly as it is — a controller calling `ExpenseModel.aggregate` directly. It's metadata (available years), not a chart transform, and it's the one endpoint in this entire set already using real MongoDB aggregation correctly. Forcing it through the Chart Service layer would add indirection with no duplication to remove.
- **The in-memory JS aggregation strategy** (fetch full document set, reduce in Node) is *not* being replaced with MongoDB `$group` pipelines in this design. That's a real, separate improvement the audit flagged under "future scaling problems" — but it's an internal detail of the Data Access layer's implementation, not something the Chart Service or Controller layers need to know about. This design deliberately makes that swap possible later (behind `fetchExpense`/`fetchBudgets`'s existing signatures) without being part of this change, keeping this design focused on removing duplication rather than also taking on a performance rewrite in the same step.

---

## 8. Migration Plan (Design-Time, Not Executed)

Mirroring how the Budget fixes were rolled out — one small, independently verifiable step at a time, each preserving 100% of current behavior:

1. Introduce `chartConstants.js` (month names) — zero risk, 3 call sites updated to import instead of declare.
2. Introduce `chartRangeResolver.js` — new file, not yet called by anything; unit-testable in isolation against the exact date math it's replacing.
3. Migrate `barchartbycategory` and `getPieCategoryData` to a single shared `getCategoryTotals`-style Chart Service function — the highest-value, lowest-risk merge, since the audit confirmed these two are already functionally identical.
4. Migrate `barchartbymonth` and `getcomparisonforpie` similarly.
5. Migrate the remaining line-chart endpoints one at a time, each verified against its current output before moving to the next (the same "verify with a synthetic-data equivalence test before/after" approach used for the `getbycategory.js` optimization earlier in this project).
6. Only after all 8 are migrated: decide, separately, whether to revisit caching consistency (today only 2 of 9 are cached) and the response-shape inconsistencies noted in §6 — both are independent of this architectural migration and shouldn't be bundled into it.

---

## 9. Summary — What Changes, What Doesn't

**Does not change:** all 9 routes, all request parameters, all response shapes, `verifyToken` placement, the expense-vs-budget data source split, `getloggedyears`'s implementation, the underlying MongoDB query strategy (still fetch-then-reduce, not `$group`-based).

**Changes (internal only):** where date-range math lives (one Range Resolver instead of 5+ inline copies), where the month-name array lives (one constant instead of 3 copies), how `barchartbycategory`/`getPieCategoryData` and `barchartbymonth`/`getcomparisonforpie` get their data (shared Chart Service functions instead of independently reimplemented logic), and how `linechartbyyear`/`barchartbymonth`/`getcomparisonforpie` reach MongoDB (through the existing Data Access primitives instead of direct model queries).

No code has been written or modified to produce this design. Ready to implement it the same way the Budget fixes were done — one numbered step from §8 at a time, with your approval before each.
