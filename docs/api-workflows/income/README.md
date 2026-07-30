# Income module — API workflow documentation

Six endpoints, all mounted under `/income`. Every one was discovered by reading
`backend/Routes/income.routes.js` and tracing outwards; none was assumed from another
module.

Diagrams reuse the approved BALENISA design system in
[`../diagram-tokens.json`](../diagram-tokens.json) and
[`../workflow_diagram.py`](../workflow_diagram.py). Nothing visual is module-specific.

## API inventory

| API ID | Method | Endpoint | Purpose | Backend handler | Frontend consumer | Status |
|---|---|---|---|---|---|---|
| INCOME-01 | `GET` | `/income/get` | List every income record | `getIncome` | `useIncomeListQuery` → `IncomeModal` | Actively used |
| INCOME-02 | `POST` | `/income/add` | Create one record | `addIncome` | `useAddIncomeMutation` → `AddIncome` | Actively used |
| INCOME-03 | `PUT` | `/income/edit` | Change an amount | `editIncome` | `useUpdateIncomeMutation` → `IncomeModal` | Actively used |
| INCOME-04 | `DELETE` | `/income/delete` | Remove one record | `deleteIncome` | `useDeleteIncomeMutation` → `IncomeModal` | Actively used |
| INCOME-05 | `POST` | `/income/insights-header` | Period totals + top source | `getInsightsHeader` | `useIncomeSummaryQuery` → `Header` | Actively used |
| INCOME-06 | `POST` | `/income/insights-card` | Runway, savings, dependency | `getInsightsCard` | `useIncomeInsightsQuery` → `OverallInsight` | Actively used |

No backend-only routes, and no frontend call pointing at a missing endpoint: every
function in `frontend/src/api/incomeApi.js` maps to exactly one route above.

## Documents

| API | Level 1 | Level 2 | Document |
|---|---|---|---|
| INCOME-01 | [overview](income-api-01-list-income-overview.svg) | [detailed](income-api-01-list-income-detailed.svg) | [income-api-01-list-income.md](income-api-01-list-income.md) |
| INCOME-02 | [overview](income-api-02-add-income-overview.svg) | [detailed](income-api-02-add-income-detailed.svg) | [income-api-02-add-income.md](income-api-02-add-income.md) |
| INCOME-03 | [overview](income-api-03-edit-income-overview.svg) | [detailed](income-api-03-edit-income-detailed.svg) | [income-api-03-edit-income.md](income-api-03-edit-income.md) |
| INCOME-04 | [overview](income-api-04-delete-income-overview.svg) | [detailed](income-api-04-delete-income-detailed.svg) | [income-api-04-delete-income.md](income-api-04-delete-income.md) |
| INCOME-05 | [overview](income-api-05-insights-header-overview.svg) | [detailed](income-api-05-insights-header-detailed.svg) | [income-api-05-insights-header.md](income-api-05-insights-header.md) |
| INCOME-06 | [overview](income-api-06-insights-card-overview.svg) | [detailed](income-api-06-insights-card-detailed.svg) | [income-api-06-insights-card.md](income-api-06-insights-card.md) |

## Structural facts that hold across the whole module

| | Value |
|---|---|
| Route mount | `app.use("/income", apiLimiter, incomeRouter)` |
| Middleware order | `apiLimiter` → `verifyToken` → *(optional Joi)* → controller |
| Redis | **None on any route.** No `getCache`, no `setCache`, no key, no TTL |
| Ownership | Enforced in the query filter (`userId` from the token), never from the body |
| Report pipeline | Income is **not** part of it — `analytics/dataProvider.js` supplies only expenses and budgets |
| Chart pipeline | Income is **not** part of it — `chart.service.js` never reads `IncomeModel` |
| Client cache | TanStack Query only, keyed under the `["income"]` prefix |
| Update strategy | **Invalidation and refetch on every mutation.** No optimistic updates, no direct cache writes, no page reloads |

## Where the workflows diverge

| | 01 list | 02 add | 03 edit | 04 delete | 05 header | 06 card |
|---|---|---|---|---|---|---|
| Joi middleware | — | yes | yes | **no** | — | — |
| Inline guards | — | — | ObjectId | ObjectId | period | period |
| DB operations | 1 read | 1 insert | 1 scoped update | 1 scoped delete | 2 parallel reads | 2 parallel reads |
| Returns data | yes | no | no | no | yes | yes |
| Fetch trigger | modal open | form submit | modal action | modal action | page mount | page mount |
| Error visible to user | toast | toast | toast | toast | toast | **console only** |

## Cross-module dependencies

`insights-header` and `insights-card` both read `ExpenseModel` alongside `IncomeModel` to
compute balance, savings rate and runway. That is a direct dependency of the income
workflow, shown inside those two diagrams — it does not make the expense endpoints part of
this batch.

## Regenerating

```bash
cd docs/api-workflows/income
for s in build_*.py; do python3 "$s"; done
```

Then rasterise, e.g. `rsvg-convert -w 3200 <name>-overview.svg -o <name>-overview.png`
and `-w 3360` for the detailed views.

## Findings roll-up

Every finding is stated with its practical consequence in the per-API documents. The three
worth reading first:

1. **`topSource` is wrong** in INCOME-05 — the reduce has no `else` branch, so the
   reported "top source" is effectively the last record, not the largest. Verified by
   running the exact expression.
2. **A body-less `POST /income/insights-header` returns `500`, not `400`** — Express 5
   leaves `req.body` undefined and the handler destructures it unguarded. Its sibling
   guards correctly. Verified by running both handlers.
3. **Deletion has no confirmation step** — one click on the trash icon permanently removes
   a record, with no dialog, no undo and no optimistic feedback.
