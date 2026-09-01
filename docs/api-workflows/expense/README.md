# Expense module — API workflow documentation

The complete expense surface: **four retrieval APIs** (API-01, API-02, API-04, API-09)
and **four mutation APIs** (API-05 … API-08), plus one non-API response-branch document
(BRANCH-01) and two combined workflows. Every route was discovered by reading
`backend/Routes/expense.routes.js` and `backend/Routes/api.routes.js` and tracing
outwards.

> **Corrected during the repository-wide API coverage gate.** `GET /expense/by-category`
> previously had two API documents (API-02 and API-03) for one route — a violation of the
> exactly-one-document-per-endpoint rule. API-02 remains that route's sole API document;
> the else-branch document is reclassified as [BRANCH-01](read/category-this-year/api-03-category-thisyear.md)
> and excluded from the API count. `GET /expense/expense-edit-data`, previously only
> cross-linked from FLOW-02 with no document of its own, now has its own API document,
> [API-09](edit-data/api-09-edit-data.md).

Diagrams reuse the approved BALENISA design system in
[`../diagram-tokens.json`](../diagram-tokens.json) and
[`../workflow_diagram.py`](../workflow_diagram.py). **No shared code was extended for the
mutation set** — the existing card, note-box, pill-group, sub-region and exception-band
components covered every stage.

## A. Retrieval APIs

| API ID | Method | Endpoint | Backend handler | Frontend hook | Status |
|---|---|---|---|---|---|
| [API-01](read/last-week/api-01-last-week.md) | `GET` | `/expense/last-week` | `lastWeekExpense` | `useExpensesQuery` | Actively used |
| [API-02](read/category-thismonth/api-02-category-thismonth.md) | `GET` | `/expense/by-category?period=thismonth` | `getByCategory` | `useExpensesQuery` | Actively used |
| [API-04](read/custom/api-04-custom-range.md) | `GET` | `/expense/search` | `getByCustom` | `useExpensesQuery` | Actively used |
| [API-09](edit-data/api-09-edit-data.md) | `GET` | `/expense/expense-edit-data` | `geteditexpense` | `useExpenseEditData` (edit form hydration) | Actively used |

These are **cross-linked, not re-documented** from the mutation documents wherever a write
invalidates or refreshes their data.

`GET /expense/by-category` has exactly one API document, [API-02](read/category-thismonth/api-02-category-thismonth.md).
Its else-branch behaviour (any `period` other than `thismonth`) is documented separately as
[BRANCH-01](read/category-this-year/api-03-category-thisyear.md) — a **non-API branch document**, not a second API
workflow for the same route. Full rationale for this reclassification is in BRANCH-01's own
header.

`GET /expense/expense-edit-data` (API-09) was previously documented only indirectly, as an
upstream dependency inside [FLOW-02](flow/retrieval-assisted-edit/flow-02-retrieval-assisted-edit.md#5-api-dependencies).
It now has its own dedicated API document; FLOW-02 continues to describe the combined
retrieval-then-edit user journey and cross-links API-09 rather than duplicating it.

## B. Mutation API inventory

| API ID | Method | Endpoint | Route mount | Backend handler | Frontend caller | Consumer | Status |
|---|---|---|---|---|---|---|---|
| [API-05](create/api-05-create-expense.md) | `POST` | `/expense/add-expense` | `app.use("/expense", apiLimiter, expenseRouter)` | `addExpense` | `addExpense` | `AddExpense.js` — manual, ML-assisted and bill-prefilled | Actively used |
| [API-06](update/api-06-update-expense.md) | `PUT` | `/expense/update-expense` | same | `editexpense` | `updateExpense` | `AddExpense.js` in edit mode | Actively used |
| [API-07](delete/api-07-delete-expense.md) | `DELETE` | `/expense/delete-expense` | same | `deleteExpense` | `deleteExpense` | `LandingPage.js` via `DeleteAlert` | Actively used |
| [API-08](toggle-recurring/api-08-toggle-recurring.md) | `PATCH` | `/api/recurring` | `app.use("/api", apiLimiter, apiRouter)` | `recurring` | `updateRecurringStatus` | `ExpenseItem.js` | Actively used |

**No bulk operations exist** — no `insertMany`, `updateMany`, `deleteMany` or `bulkWrite`
anywhere in the backend. No restore or archive route. No backend-only mutation, and no
frontend call pointing at a missing endpoint.

API-08 is included here rather than under Budget: it mutates an `Expense` document, its
client function lives in `expenseApi.js`, and `ExpenseItem.js` is its only consumer. It
happens to be mounted on the shared `/api` router next to the three budget routes.

## C. Documents

| # | Workflow | Classification | Level 1 | Level 2 | Document |
|---|---|---|---|---|---|
| API-09 | Edit-data hydration | Retrieval, single-record read for the edit form | [svg](edit-data/api-09-edit-data-overview.svg) | [svg](edit-data/api-09-edit-data-detailed.svg) | [md](edit-data/api-09-edit-data.md) |
| BRANCH-01 | Yearly category view | Non-API response branch of API-02, not a source endpoint of its own | [svg](read/category-this-year/api-03-category-thisyear-overview.svg) | [svg](read/category-this-year/api-03-category-thisyear-detailed.svg) | [md](read/category-this-year/api-03-category-thisyear.md) |
| API-05 | Create expense | Manual + ML-assisted + bill-prefilled creation → multi-cache invalidation | [svg](create/api-05-create-expense-overview.svg) | [svg](create/api-05-create-expense-detailed.svg) | [md](create/api-05-create-expense.md) |
| API-06 | Update expense | Edit/update → multi-cache invalidation | [svg](update/api-06-update-expense-overview.svg) | [svg](update/api-06-update-expense-detailed.svg) | [md](update/api-06-update-expense.md) |
| API-07 | Delete expense | Deletion → multi-cache invalidation | [svg](delete/api-07-delete-expense-overview.svg) | [svg](delete/api-07-delete-expense-detailed.svg) | [md](delete/api-07-delete-expense.md) |
| API-08 | Toggle recurring | Mutation with an optimistic update and **no** invalidation | [svg](toggle-recurring/api-08-toggle-recurring-overview.svg) | [svg](toggle-recurring/api-08-toggle-recurring-detailed.svg) | [md](toggle-recurring/api-08-toggle-recurring.md) |
| FLOW-01 | ML-assisted entry | Combined prediction → user review → explicit persistence | [svg](flow/ml-assisted-entry/flow-01-ml-assisted-entry-overview.svg) | [svg](flow/ml-assisted-entry/flow-01-ml-assisted-entry-detailed.svg) | [md](flow/ml-assisted-entry/flow-01-ml-assisted-entry.md) |
| FLOW-02 | Retrieval-assisted edit | Retrieval-assisted edit flow, two requests | [svg](flow/retrieval-assisted-edit/flow-02-retrieval-assisted-edit-overview.svg) | [svg](flow/retrieval-assisted-edit/flow-02-retrieval-assisted-edit-detailed.svg) | [md](flow/retrieval-assisted-edit/flow-02-retrieval-assisted-edit.md) |

Plus the consumption map.

The bill-prefilled creation path is **not** a separate workflow here — it reaches API-05
unchanged and is documented as
[BILLS-FLOW-01](../bills/flow/bills-flow-01-scan-to-expense.md), cross-linked from both sides.

## D. What each operation does

| | Persists data | Atomic | Retry safe | Optimistic | Downstream invalidation |
|---|---|---|---|---|---|
| API-05 create | yes | single request, but 2 inserts + 3 follow-ups, untransacted | no — a repeat is a duplicate-key 500 | no | expenses, budgets, reports, charts + Redis |
| API-06 update | yes | as above | **yes** — idempotent for the same payload | no | as above |
| API-07 delete | yes | as above | first call 200, later calls 404 | no | as above |
| API-08 recurring | yes | **no** — two independent writes | mark twice → 400; unmark twice → 200 | **yes**, with rollback | **none** |
| FLOW-01 prediction | **no** | n/a | **yes** — writes nothing | n/a | none |
| FLOW-02 hydration | **no** | n/a | yes | n/a | none |

**Prediction is advisory, never authoritative.** The field is a plain text input, never
disabled, and no confidence threshold gates it. Prediction failure never blocks a submit.

## E. Structural facts across the mutation set

| | Value |
|---|---|
| Route mounts | `/expense` for create, update and delete; `/api` for the recurring toggle |
| Middleware order | `apiLimiter` → `verifyToken` → (validation, on create only) → controller |
| Rate limiting | `apiLimiter`, 150 req / 15 min. Mounted before `verifyToken`, so **keyed by IP**, not by user |
| Validation | **Joi on create only.** Update, delete and recurring have no validation middleware |
| Ownership | Always in the query filter — `{ _id, userId }`. No cross-account write path exists |
| ObjectId guard | Present on update, delete and the hydration read. **Absent on `PATCH /api/recurring`** |
| Derived-data synchronization | Create, update and delete reserve recovery evidence before their primary write, clear expense caches, and call fenced `synchronizeAfterMutation`; success responses include additive `derivedData` status. |
| Client cache | Four prefix invalidations on create, update and delete. **None on recurring** |
| Mutation retry | `0` everywhere (`queryClient.js` default) |
| Optimistic updates | API-08 only |
| Transactions | None anywhere |

## F. Where the mutations diverge

| | API-05 | API-06 | API-07 | API-08 |
|---|---|---|---|---|
| Verb | `POST` | `PUT` | `DELETE` | `PATCH` |
| Target id | none (created) | query string | request body | request body |
| Joi validation | **yes** | no | no | no |
| ObjectId guard | n/a | yes | yes | **no** |
| Fields writable | 9 named | 5 whitelisted | — | `isRecurring` only |
| Zero/negative amount | **rejected** | **accepted** | n/a | n/a |
| Collections written | 1–2 | 1 | 1 | 2 |
| Budget recalculated | always | only if amount/date changed | always | never |
| Redis cleared | yes | yes | yes | **no** |
| Queries invalidated | 4 | 4 | 4 | **0** |
| Response body | message | message + document | message | message |
| Not-found status | n/a | 404 | 404 | **403** |
| Duplicate-click guard | spinner overlay | spinner overlay | spinner overlay | **none** |

## G. Findings roll-up

Full findings with consequences live in the six workflow documents. The seven worth reading
first — the first four verified by executing the real schema and Mongoose casting:

1. **Update performs no validation whatsoever.** No Joi, and `runValidators` is not set on
   `findOneAndUpdate`, so schema `required` rules never run. An empty name, a
   whitespace-only name, a zero, a negative and a `null` amount are all accepted and
   stored.
2. **Create and update disagree about the same field.** Joi rejects a non-positive amount
   on create; nothing rejects it on update.
3. **Cast failures surface as 500, not 400.** `expenseAmount: "abc"`, an unparseable date
   and an operator object each raise `CastError`, which the generic catch reports as
   `Internal Server Error`.
4. **Month attribution shifts west of UTC.** `<input type="date">` yields UTC midnight while
   `getMonthRange` reads local time. With `TZ=America/New_York`, an expense dated
   `2026-07-01` recalculates the **`Jun 2026`** budget — every first-of-month expense lands
   in the previous month.
5. **`PATCH /api/recurring` reconciles nothing.** It clears no Redis key and invalidates no
   query, so the optimistic patch is never compared with the server and cached reads keep
   the old flag for up to 300 s.
6. **Prediction telemetry can outlive its name.** `mlPredictedCategory` is cleared only on a
   successful save, so a later bill prefill or edit load can submit a prediction that was
   made for a different expense.
7. **Deleting an expense leaves its recurring schedule behind.** The `RecurringExpense` row
   still references the deleted `expenseId`, and the nightly cron keeps creating expenses
   from it.

Positives worth recording: ownership is enforced inside every query filter, so no
cross-account write is possible; the update allow-list closes both mass assignment and
prototype pollution; a client-supplied `userId` is always overwritten from the token; the
ML service URL never reaches the browser; and no response leaks a stack trace or a database
message.

## H. Regenerating

```bash
cd docs/api-workflows/expense
python3 build_overview.py && python3 build_detailed.py                # API-01
python3 build_api02_overview.py && python3 build_api02_detailed.py    # API-02
python3 build_api03_overview.py && python3 build_api03_detailed.py    # BRANCH-01
python3 build_api04_overview.py && python3 build_api04_detailed.py    # API-04
python3 build_api09_overview.py && python3 build_api09_detailed.py    # API-09
python3 build_expense_mutations_overviews.py                          # API-05 … FLOW-02
python3 build_expense_mutations_detailed.py
```

Every script resolves the shared engine with
`sys.path.insert(0, os.path.dirname(HERE))` and writes with `os.path.join(HERE, …)`, so all
twelve work from any working directory.

Then rasterise at 2×, e.g. `rsvg-convert -w 3200 <name>-overview.svg -o <name>-overview.png`
and `-w 3360` for the detailed views.
