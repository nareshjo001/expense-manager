# Budget module — API workflow documentation

Three endpoints, all mounted under `/api`. Every one was discovered by reading
`backend/Routes/api.routes.js`; that file mounts no other budget route, so this is the
complete budget surface.

Diagrams reuse the approved BALENISA design system in
[`../diagram-tokens.json`](../diagram-tokens.json) and
[`../workflow_diagram.py`](../workflow_diagram.py).

## API inventory

| API ID | Method | Endpoint | Purpose | Backend handler | Frontend consumer | Status |
|---|---|---|---|---|---|---|
| BUDGET-01 | `GET` | `/api/getbudgets` | Full budget history | `getbudgets` | `useBudgetsQuery` → `SetBudget`, `Header` | Actively used |
| BUDGET-02 | `POST` | `/api/setbudget` | Set this month's budget | `setbudget` | `useCreateBudgetMutation` → `SetBudget` | Actively used |
| BUDGET-03 | `PUT` | `/api/update-budget` | Edit this month's budget | `updatebudget` | `useUpdateBudgetMutation` → `Header` | **Duplicate/overlapping** — see below |

No backend-only routes, and no frontend call pointing at a missing endpoint: every
function in `frontend/src/api/budgetApi.js` maps to exactly one route above.

**BUDGET-02 and BUDGET-03 are behaviourally near-identical.** Both upsert the current
month's document, both recalculate `spent`, both refresh the report. Neither verb is
create-only or update-only. They are documented separately because they are separate
controllers with genuinely different response bodies and callers; the full difference
table lives in [BUDGET-03 §5](budget-api-03-update-budget.md).

## Documents

| API | Level 1 | Level 2 | Document |
|---|---|---|---|
| BUDGET-01 | [overview](budget-api-01-get-budgets-overview.svg) | [detailed](budget-api-01-get-budgets-detailed.svg) | [budget-api-01-get-budgets.md](budget-api-01-get-budgets.md) |
| BUDGET-02 | [overview](budget-api-02-set-budget-overview.svg) | [detailed](budget-api-02-set-budget-detailed.svg) | [budget-api-02-set-budget.md](budget-api-02-set-budget.md) |
| BUDGET-03 | [overview](budget-api-03-update-budget-overview.svg) | [detailed](budget-api-03-update-budget-detailed.svg) | [budget-api-03-update-budget.md](budget-api-03-update-budget.md) |

## Structural facts that hold across the whole module

| | Value |
|---|---|
| Route mount | `app.use("/api", apiLimiter, apiRouter)` |
| Middleware order | `apiLimiter` → `verifyToken` → controller. **No validation middleware on any budget route** |
| Redis for budget data | **None.** No `getCache`, no `setCache`, no key, no TTL |
| Other Redis touched | The two writes call `refreshReport`, which invalidates and repopulates `report:<userId>` (TTL 1 h) |
| Ownership | Enforced from the token; no budget id or month is ever accepted from the client |
| Month targeting | Both writes hardcode the current month — a past month cannot be set or edited through the API |
| Duplicate protection | Unique index `{ userId: 1, month: 1 }` |
| Client cache | TanStack Query, key `["budgets"]`, shared by both consumers |
| Update strategy | **Invalidation and refetch.** No optimistic updates, no direct cache writes |

## Where the workflows diverge

| | BUDGET-01 | BUDGET-02 | BUDGET-03 |
|---|---|---|---|
| Verb | `GET` | `POST` | `PUT` |
| MongoDB operations | 1 read | 3 writes + 1 aggregate | 3 writes + 1 aggregate |
| Upsert location | — | `setBudgetForCurrentMonth` service | inlined in the controller |
| Report refresh arg | — | `user._id` (ObjectId) | `req.userId` (string) |
| Response body | full history | message only | message + document |
| Client feedback | — | success toast | modal closes, no success toast |
| Client error state | handled in `SetBudget`, **not** in `Header` | toast | toast |

## Cross-module dependencies

- **Expenses → budget.** `spent` is a stored field, not computed on read.
  `recalculateBudget` rewrites it whenever an expense is added, edited, deleted, or created
  by the recurring cron. It runs **without** `upsert`, so an expense in a month with no
  budget document changes nothing.
- **Budget → reports.** Both writes call `refreshReport` synchronously, inside the request.
- **Budget → charts and analytics.** `chart.service.js` and `analytics/dataProvider.js`
  read `BudgetModel` directly rather than through these endpoints.

## Regenerating

```bash
cd docs/api-workflows/budget
for s in build_*.py; do python3 "$s"; done
```

## Findings roll-up

Full findings with consequences live in the per-API documents. The three worth reading
first:

1. **Three different sources build the same `"Mon YYYY"` key** — Node's locale on the
   server, the browser's locale in `useBudgetSummary`, and always-English date-fns in
   `SetBudget`/`BudgetBar`. On a non-English browser the header shows ₹ 0 while the budget
   bar renders correctly on the same page.
2. **Three writes with no transaction** — a failure after the upsert returns `500` with the
   budget already committed and `spent` or the report stale.
3. **The edit modal never pre-fills** — `useState(totalBudget || "")` captures the value
   before the query resolves, and nothing syncs it afterwards.
