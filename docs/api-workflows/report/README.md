# Report / Analytics Engine module — workflow documentation

One public endpoint, plus two internal flows. All three were discovered by reading
`backend/Routes/report.routes.js` outward through `backend/analytics/` and
`backend/Services/reportService.js`; nothing else mounts a report route.

**The Report is the externally consumed result.** One endpoint reads it, one hook fetches
it, four UI components render slices of it. **The Analytics Engine is the internal
computation pipeline that produces it** — no HTTP boundary, no direct user trigger,
invoked only from a cache miss or a mutation-triggered refresh.

Diagrams reuse the approved BALENISA design system in
[`../diagram-tokens.json`](../diagram-tokens.json) and
[`../workflow_diagram.py`](../workflow_diagram.py).

## Workflow inventory

| ID | Type | Purpose | Documented in |
|---|---|---|---|
| REPORT-01 | API — `GET /report` | Cache-first read of the whole report | [report-api-01-get-report.md](report-api-01-get-report.md) |
| FLOW-01 | Internal flow | The Analytics Engine — context, 6 analyzers, 6 score calculators, aggregation | [report-flow-01-analytics-engine.md](report-flow-01-analytics-engine.md) |
| FLOW-02 | Internal flow | Mutation-triggered synchronous refresh (Expense/Budget writes) | [report-flow-02-mutation-refresh.md](report-flow-02-mutation-refresh.md) |

**That is the complete surface.** One route, no create/update/delete/list endpoints for
the report itself — the object is always read or written whole.

## Documents

| Workflow | Level 1 | Level 2 | Document |
|---|---|---|---|
| REPORT-01 | [overview](report-api-01-get-report-overview.svg) | [detailed](report-api-01-get-report-detailed.svg) | [report-api-01-get-report.md](report-api-01-get-report.md) |
| FLOW-01 | [overview](report-flow-01-analytics-engine-overview.svg) | [detailed](report-flow-01-analytics-engine-detailed.svg) | [report-flow-01-analytics-engine.md](report-flow-01-analytics-engine.md) |
| FLOW-02 | [overview](report-flow-02-mutation-refresh-overview.svg) | [detailed](report-flow-02-mutation-refresh-detailed.svg) | [report-flow-02-mutation-refresh.md](report-flow-02-mutation-refresh.md) |

Full inventory tables (frontend consumption, Analytics Engine components, data
dependencies, cache, cross-module links): [report-consumption-map.md](report-consumption-map.md).

## Structural facts that hold across the whole module

| | Value |
|---|---|
| Route mount | `app.use("/report", apiLimiter, reportRoutes)` |
| Middleware order | `apiLimiter` → `verifyToken` → `getReport` |
| Redis | `report:<userId>`, TTL 3600 s — the only cache in this module |
| Mongo | `FinancialReport`, one document per user (`unique: true`), Mixed-typed sections |
| ML / SIA dependency | **None** — confirmed absent from every analyzer and score calculator |
| Ownership | Enforced from the token; no report id is ever accepted from the client |
| Client cache | TanStack Query, key `["reports"]`, one entry, no parameters |
| Update strategy | **Invalidation and refetch**, driven by Expense/Budget mutations — no manual refresh control exists |

## Cross-module dependencies

- **Expenses/Budget → Report.** Six call sites (`addexpense`, `editExpense`,
  `deleteExpense`, `setbudget`, `updatebudget`, `recurringJob`) call `refreshReport`
  synchronously, inside their own request — see FLOW-02.
- **Report → Expenses/Budget.** Read-only, via 5 parallel Mongo queries in
  `createAnalyticsContext` — see FLOW-01.
- **Income → Report.** No relationship. The engine never reads `IncomeModel`; the
  frontend invalidates `reports.all` on income mutations anyway (harmless no-op).
- **Charts.** No direct relationship — Charts computes its own aggregations
  independently of the Analytics Engine.

## Regenerating

```bash
cd docs/api-workflows/report
python3 build_report_overviews.py
python3 build_report_detailed.py
```

Both scripts are cwd-independent (they resolve the shared design system relative to
their own file location) and were verified to run from `/tmp`.

## Findings roll-up

Full findings with consequences live in the per-workflow documents. The three worth
reading first:

1. **The habit score, the stability bonus, and every habit-derived health signal are
   computed from an always-empty stub.** `reportGenerator.js` passes `monthlyHabits`;
   `healthAnalyzer.js` destructures `habits`. Verified by execution.
2. **`summary.healthScore` and `summary.riskLevel` are always `undefined`** — the real
   values live at `financialHealth.overall` / `financialHealth.risk`, which no frontend
   component reads at all.
3. **Every Expense/Budget mutation's HTTP response blocks on a full Analytics Engine
   recompute,** and a failure during that recompute reports as a total mutation failure
   even though the underlying write already committed.
