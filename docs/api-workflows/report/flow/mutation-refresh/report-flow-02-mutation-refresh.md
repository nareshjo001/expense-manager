# FLOW-02 — Mutation-triggered Report refresh

A combined Expense/Budget → Report workflow. **Synchronous, not background — the
triggering mutation's own HTTP response waits for the entire Analytics Engine to
finish.** Every statement below is traced to the current repository implementation.

---

## 1. Purpose

Describes what happens between an Expense or Budget write and the cached/persisted
report reflecting it — the part no single endpoint fully owns, since the trigger lives
in six different mutation controllers.

## 2. Classification

Using the module's classification list: **type 6 — cross-module synchronous side
effect**, spanning Expense, Budget and Report. Not a type-4 frontend flow (no distinct
UI screen); not a type-2 upload flow.

| Question | Answer |
|---|---|
| Is the refresh awaited by the triggering request? | **Yes** |
| Is it queued or backgrounded? | **No** |
| Does the triggering mutation share a try/catch with the refresh? | **Yes**, in every caller |
| Can the refresh fail independently of the mutation succeeding? | **Yes** — and the client is told the whole request failed |
| Does Income trigger this? | **No** — confirmed absent from Income controllers |

## 3. Level 1 quick workflow

<picture>
  <source srcset="report-flow-02-mutation-refresh-overview.svg" type="image/svg+xml">
  <img src="report-flow-02-mutation-refresh-overview.png" alt="Overview of the mutation-triggered report refresh">
</picture>

Vector: [`report-flow-02-mutation-refresh-overview.svg`](report-flow-02-mutation-refresh-overview.svg) ·
raster fallback: [`report-flow-02-mutation-refresh-overview.png`](report-flow-02-mutation-refresh-overview.png)

## 4. Level 2 detailed workflow

<picture>
  <source srcset="report-flow-02-mutation-refresh-detailed.svg" type="image/svg+xml">
  <img src="report-flow-02-mutation-refresh-detailed.png" alt="Detailed mutation-triggered report refresh workflow">
</picture>

Vector: [`report-flow-02-mutation-refresh-detailed.svg`](report-flow-02-mutation-refresh-detailed.svg) ·
raster fallback: [`report-flow-02-mutation-refresh-detailed.png`](report-flow-02-mutation-refresh-detailed.png)

## 5. Trigger and input state

Six call sites, grep-confirmed:

| Caller | File |
|---|---|
| Create expense | `Controllers/ExpenseControllers/addexpense.js` |
| Edit expense | `Controllers/ExpenseControllers/editExpense.js` |
| Delete expense | `Controllers/ExpenseControllers/deleteExpense.js` |
| Set budget | `Controllers/BudgetControllers/setbudget.js` |
| Update budget | `Controllers/BudgetControllers/updatebudget.js` |
| Recurring expense cron | `cron/recurringJob.js` |

Every HTTP caller invokes `refreshReport(userId)` **after its own primary write has
already committed**, and **before** sending its response.

## 6. Upstream and downstream API dependencies

| Step | Documented in |
|---|---|
| Triggering mutation | [Expense API-05/06/07](../expense/README.md), [Budget BUDGET-02/03](../budget/README.md) |
| The recompute itself | [FLOW-01 — the Analytics Engine](report-flow-01-analytics-engine.md) |
| The next read | [REPORT-01](report-api-01-get-report.md) — served from the now-warm Redis cache |

## 7. Data transformations

None specific to this flow — `refreshReport` calls the same `generateReport` documented
in FLOW-01 with no different input shape. The only transformation is the Redis
invalidate-then-repopulate sequence.

## 8. Refresh sequence

1. The triggering write commits (e.g. `newExpense.save()`).
2. The mutation's own propagation runs (e.g. `recalculateBudget`,
   `clearUserExpenseCache` for Expense) — documented in those modules, not here.
3. `refreshReport(userId)` is called and **awaited**:
   1. `reportCache.invalidate(userId)` — Redis key deleted **first**, before recompute.
   2. `generateReport(userId)` — full engine run, identical to FLOW-01.
   3. `FinancialReport.findOneAndUpdate({user: userId}, {...generated}, {upsert: true,
      runValidators: true, setDefaultsOnInsert: true}).lean()`.
   4. `reportCache.set(userId, updatedReport)` — Redis repopulated, 1 h TTL.
4. Only after all of the above resolves does the triggering mutation send its own HTTP
   response.

## 9. Persistence boundary

The Expense/Budget write and the Report upsert are **two independent Mongo operations,
no transaction**. The Expense/Budget write is already durable by the time the refresh
even starts.

## 10. Failure and recovery behaviour

| Failure | Effect | Recovery |
|---|---|---|
| `refreshReport` throws (Redis or Mongo) | The mutation's shared try/catch returns a generic 500 — **the client is told the mutation failed even though it already committed** | The underlying Expense/Budget change persists silently; the next report read pays a full recompute since the cache was already invalidated in step 3.1 |
| Redis down for `invalidate`/`set` | Caught and swallowed at the cache-module boundary — degrades to Mongo-backed correctness with a caching-performance cost only | No user-visible failure from Redis alone |
| Two mutations for the same user race | Each independently invalidates, recomputes, and overwrites — last write wins, no stampede lock | Both refreshes eventually complete; the final cached/persisted state reflects whichever finished last |

There is no partial-success case in which the Expense/Budget write is rolled back
because the refresh failed — rollback never happens.

## 11. Cache behaviour after the refresh

`reportCache` is invalidated then immediately repopulated — a request racing the
invalidate-to-set window sees a genuine Redis miss and falls through to Mongo, which may
itself be mid-upsert. Frontend-side, the triggering mutation's own `onSuccess` invalidates
`queryKeys.reports.all` among its other query families, so the next report read is a
fresh fetch — typically served instantly from the now-warm Redis cache.

## 12. Files involved

| Layer | File | Function/Export | Purpose |
|---|---|---|---|
| Trigger (example) | `backend/Controllers/ExpenseControllers/addexpense.js` | `addExpense` | Saves the expense, then awaits `refreshReport` before responding |
| Trigger (example) | `backend/Controllers/BudgetControllers/setbudget.js` | `setbudget` | Same pattern for a budget write |
| Trigger (non-HTTP) | `backend/cron/recurringJob.js` | — | Scheduled job, same call |
| Refresh entrypoint | `backend/Services/reportService.js` | `refreshReport` | Invalidate → recompute → upsert → cache |
| Engine | `backend/analytics/reportGenerator.js` | `generateReport` | Documented in FLOW-01 |
| Cache | `backend/cache/reportCache.js` | `invalidate`, `set` | `report:<userId>`, TTL 3600 s |
| Model | `backend/models/Report.js` | `FinancialReport` | Upserted unconditionally |

---

## 13. Findings

**Summary:** Correctness 1 · Security / operational 0 · Reliability 3 · Maintainability 1

### Correctness

1. **Income never triggers this flow.** Grep-confirmed absent from every Income
   controller — consistent with the engine never reading `IncomeModel` at all. The
   frontend's `reports.all` invalidation on income mutations is therefore a harmless
   no-op refetch, not a genuine staleness bug.

### Reliability

2. **The triggering mutation's response blocks on the full Analytics Engine.** Every
   Expense/Budget write pays the entire engine's cost — 5 queries, 6 analyzers, 6 score
   calculators — inside its own request, with no async or background path.

3. **Failure after commit reports as total failure.** `refreshReport`,
   `recalculateBudget` and `clearUserExpenseCache` share the triggering mutation's own
   try/catch. If `refreshReport` throws, the client receives a generic 500 for a write
   that already succeeded.

4. **No stampede protection.** Concurrent mutations for the same user each independently
   invalidate, recompute and overwrite Mongo/Redis — last write wins, with no lock or
   coalescing.

### Maintainability

5. **The refresh logic is duplicated by reference across six call sites** rather than
   centralized in shared mutation middleware — a future seventh mutation type must
   remember to call `refreshReport` itself; nothing enforces it structurally.
