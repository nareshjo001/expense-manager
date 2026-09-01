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
| REPORT-01 | API — `GET /report` | Repair-on-read, revision-aware report read | [reference](get-report/report-consumption-map.md#a-report-api-inventory) |
| FLOW-01 | Internal flow | The Analytics Engine — context, analyzers, score calculators, aggregation | [document](flow/analytics-engine/report-flow-01-analytics-engine.md) |
| FLOW-02 | Internal flow | Reserved, revision-fenced synchronization after mutations | [document](flow/mutation-refresh/report-flow-02-mutation-refresh.md) |

**That is the complete surface.** One route, no create/update/delete/list endpoints for
the report itself — the object is always read or written whole.

## Documents

| Workflow | Level 1 | Level 2 | Document |
|---|---|---|---|
| REPORT-01 | [overview](get-report/report-api-01-get-report-overview.svg) | [detailed](get-report/report-api-01-get-report-detailed.svg) | [reference](get-report/report-consumption-map.md#a-report-api-inventory) |
| FLOW-01 | [overview](flow/analytics-engine/report-flow-01-analytics-engine-overview.svg) | [detailed](flow/analytics-engine/report-flow-01-analytics-engine-detailed.svg) | [document](flow/analytics-engine/report-flow-01-analytics-engine.md) |
| FLOW-02 | [overview](flow/mutation-refresh/report-flow-02-mutation-refresh-overview.svg) | [detailed](flow/mutation-refresh/report-flow-02-mutation-refresh-detailed.svg) | [document](flow/mutation-refresh/report-flow-02-mutation-refresh.md) |

Full inventory tables are in report-consumption-map.md.

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
| Update strategy | Reservation, revision-fenced refresh, and repair-on-read across Expense, Income, and Budget mutations |

## Cross-module dependencies

- **Expenses/Income/Budget → Report.** Their mutation controllers reserve report work before
  the primary write, then call `synchronizeAfterMutation`; a failed derived-data refresh is
  retained for repair-on-read — see FLOW-02.
- **Report → Expenses/Budget.** Read-only, via 5 parallel Mongo queries in
  `createAnalyticsContext` — see FLOW-01.
- **Income → Report.** Income mutations synchronize the report even though this analytics
  engine currently derives its sections from expense and budget data.
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

1. **Derived-data synchronization remains synchronous,** but failures retain durable pending
   work and are repaired on a later report read rather than silently serving stale data.
