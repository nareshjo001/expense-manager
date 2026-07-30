# Expense consumption map

Every expense-mutating route, every UI touchpoint that reaches one, and every cache or
aggregate a mutation moves. Traced from `backend/Routes/expense.routes.js`,
`backend/Routes/api.routes.js` and `frontend/src/components/expensesHandling/` outwards.

The four approved **retrieval** APIs are documented separately and are cross-linked here
rather than repeated — see [the module index](README.md).

## A. Expense mutation API inventory

| API ID | Method | Endpoint | Route mount | Middleware | Backend handler | Frontend caller | Consumer | Status |
|---|---|---|---|---|---|---|---|---|
| [API-05](api-05-create-expense.md) | `POST` | `/expense/add-expense` | `app.use("/expense", apiLimiter, expenseRouter)` | `apiLimiter` → `verifyToken` → `expenseValidation` | `addExpense` | `addExpense` in `expenseApi.js` | `AddExpense.js` (manual, ML-assisted and bill-prefilled) | Actively used |
| [API-06](api-06-update-expense.md) | `PUT` | `/expense/update-expense` | same | `apiLimiter` → `verifyToken` | `editexpense` | `updateExpense` | `AddExpense.js` in edit mode | Actively used |
| [API-07](api-07-delete-expense.md) | `DELETE` | `/expense/delete-expense` | same | `apiLimiter` → `verifyToken` | `deleteExpense` | `deleteExpense` | `LandingPage.js` via `DeleteAlert` | Actively used |
| [API-08](api-08-toggle-recurring.md) | `PATCH` | `/api/recurring` | `app.use("/api", apiLimiter, apiRouter)` | `apiLimiter` → `verifyToken` | `recurring` | `updateRecurringStatus` | `ExpenseItem.js` | Actively used |

**Four unique mutation endpoints — that is the whole write surface for expenses.** Traced
by grepping every write against `ExpenseModel` outside `node_modules`:

```
Controllers/ExpenseControllers/addexpense.js:68     new ExpenseModel({...})
Controllers/ExpenseControllers/deleteExpense.js:24  ExpenseModel.findOneAndDelete(...)
Controllers/ExpenseControllers/editExpense.js:52    ExpenseModel.findOneAndUpdate(...)
Controllers/RecurringExpenses/recurring.js:50,65    expense.save()
cron/recurringJob.js:60                             ExpenseModel.create(...)
```

The last is a scheduled job, not an endpoint — see §F.

| Operation | Endpoint? |
|---|---|
| Create | Yes — API-05 |
| Update | Yes — API-06 (partial, five whitelisted fields) |
| Delete | Yes — API-07 (hard delete) |
| Toggle recurring | Yes — API-08 |
| Bulk create / update / delete | **No.** No `insertMany`, `updateMany`, `deleteMany` or `bulkWrite` anywhere in the backend |
| Restore / archive / undo | **No.** No soft-delete flag, no archive collection |
| Categorisation during entry | Prediction only, and it persists nothing — see [FLOW-01](flow-01-ml-assisted-entry.md) |

No backend-only mutation route, and no frontend call pointing at a missing endpoint: every
function in `frontend/src/api/expenseApi.js` maps to exactly one live route.

### Reused, not re-documented

| Endpoint | Role | Document |
|---|---|---|
| `GET /expense/last-week` | Post-mutation refresh | [API-01](api-01-last-week.md) |
| `GET /expense/by-category?period=thismonth` | Post-mutation refresh | [API-02](api-02-category-thismonth.md) |
| `GET /expense/by-category` (else branch) | Post-mutation refresh | [BRANCH-01](api-03-category-thisyear.md) — non-API branch of API-02, not a second API document |
| `GET /expense/search` | Post-mutation refresh | [API-04](api-04-custom-range.md) |
| `GET /expense/expense-edit-data` | Edit-form hydration | [API-09](api-09-edit-data.md) |
| `POST /ml/predict-category` | Advisory prediction during entry | Backend proxy route, now its own document: [ML-API-11](../ml-service/ml-api-11-backend-predict-proxy.md) |
| `POST /expense/add-expense` from the bill flow | Same endpoint, second consumer | [BILLS-FLOW-01](../bills/bills-flow-01-scan-to-expense.md) |

## B. Frontend mutation inventory

| UI ID | Page/component | User action | Initial data | Mutation/API | State owner | Success result | Failure result |
|---|---|---|---|---|---|---|---|
| M-1 | `Add.js` | Toggle to **Add Expense** | — | none | `Add` (`type`) | Renders `AddExpense` | — |
| M-2 | `AddExpense.js` — five fields | Type | empty | none | `AddExpense` (`useState` × 5) | Enables submit | — |
| M-3 | `AddExpense.js` — name field | Type ≥ 3 chars | typed text | `POST /ml/predict-category` | `AddExpense` | Category + confidence filled | Silent; field stays empty |
| M-4 | `AddExpense.js` — bill prompt | Click **Upload** | — | none | `AddExpense` (`isBillUpload`) | Renders `BillUpload` | — |
| M-5 | `AddExpense.js` — prefill effect | Automatic on `billData` | [BILLS-01](../bills/bills-api-01-upload-and-extract.md) | none | `AddExpense` | Three of five fields filled | — |
| M-6 | `AddExpense.js` — submit (create) | Click **Add Expense** | form state | API-05 | `useAddExpenseMutation` | Toast, form cleared, `navigate('/')` | Toast; **form preserved** |
| M-7 | `AddExpense.js` — hydration effect | Automatic when `isEdit.enableEdit` | `GET /expense/expense-edit-data` | read | `AddExpense` + query cache | Five fields hydrated | Console only; blank form |
| M-8 | `AddExpense.js` — submit (update) | Click **Update Expense** | form state | API-06 | `useUpdateExpenseMutation` | Toast, form cleared, `navigate('/')` | Toast; **edits preserved** |
| M-9 | `ExpenseItem.js` — edit icon / menu | Click | `expense._id` | none | `LandingPage` (`isEdit`) | Navigates to `/add` in edit mode | — |
| M-10 | `ExpenseItem.js` — delete icon / menu | Click | `expense._id` | none | `LandingPage` (`confirmDeleteId`) | Opens `DeleteAlert` | — |
| M-11 | `DeleteAlert.js` — **Yes, Delete** | Click | `confirmDeleteId` | API-07 | `useDeleteExpenseMutation` | Toast, modal closes, row removed on refetch | Toast; **modal stays open** |
| M-12 | `DeleteAlert.js` — **Cancel** | Click | — | none | `LandingPage` | Modal closes, nothing sent | — |
| M-13 | `ExpenseItem.js` — recurring icon / menu | Click | cached `isRecurring` | API-08 | `useUpdateRecurringMutation` | Icon already flipped; toast | Cache rolled back; toast |

**Thirteen touchpoints, six of which issue a network request** (M-3, M-6, M-7, M-8, M-11,
M-13). Two of those six — M-3 and M-7 — are reads.

| Property | Value |
|---|---|
| Submit protection (create/update) | Full-screen `Spinner`, `z-index: 9999`. **No `disabled` on the button** |
| Submit protection (delete) | The same overlay, above the modal's `z-index: 999` |
| Submit protection (recurring) | **None** — no overlay, no disabled state, no confirmation |
| Optimistic updates | **Only** API-08. API-05/06/07 are pessimistic |
| Rollback | Only API-08, via the `onMutate` snapshot |
| Mutation retry | `0` for every mutation — `queryClient.js` default |
| Form state after failure | **Preserved.** Only `onSuccess` clears fields |
| Navigation after success | `navigate('/')` for create and update; delete stays put |
| Behaviour on unmount | Blob URLs and the prediction request are aborted; the mutations themselves are not cancelled |
| Client field caps | category 20, description 25, amount `min={0}`, all five `required` |
| Server field caps | **None** on length. Amount must be positive on create, unchecked on update |

## C. Mutation side-effect and cache inventory

| Mutation | Database effect | Backend cache invalidated | Frontend query invalidated | UI consumers affected | Missing/stale consumers |
|---|---|---|---|---|---|
| **API-05** create | 1 expense insert, optionally 1 `mlFeedback` insert, 1 budget `spent` update | `lastWeek:<userId>`, `category:<userId>:<period>`, `pie:<userId>:…`, `pieComparison:<userId>:…` (all via `cachekeys:<userId>`), plus `report:<userId>` regenerated | `["expenses"]`, `["budgets"]`, `["reports"]`, `["charts"]` | Expense list, budget bar, all charts, insights, report | None found |
| **API-06** update | 1 scoped `$set`, 1–2 budget `spent` updates (only if amount or date changed) | identical to API-05 | identical to API-05 | identical, plus the edit-detail entry | `RecurringExpense` snapshot keeps the old name/category/amount |
| **API-07** delete | 1 hard delete, 1 budget `spent` update | identical to API-05 | identical to API-05 | identical | `RecurringExpense` row and any `Notification` are orphaned |
| **API-08** recurring | 1 `expense.save()`, 1 schedule row created or deleted | **None** | **None** | Only the optimistic patch | Cached expense reads keep the old flag for up to 300 s; the patch is never reconciled |

### Exact keys, traced

**Redis.** `clearUserExpenseCache(userId)` reads the set `cachekeys:<userId>` and deletes
every member. Membership is added by `setCache`, which derives the owner as
`key.split(':')[1]`. All four cached read keys put the userId in that position, so all four
are genuinely cleared:

| Key template | Written by | TTL | Cleared by an expense write |
|---|---|---|---|
| `lastWeek:<userId>` | `lastweekexpense.js:69` | 300 s | yes |
| `category:<userId>:<period>` | `getbycategory.js:76` | 300 s | yes |
| `pie:<userId>:<year>:<type>` | `getPieCategoryData.js:43` | 300 s | yes |
| `pieComparison:<userId>:<month>` | `getcomparisonforpie.js:54` | 300 s | yes |
| `report:<userId>` | `reportCache.set` | 3 600 s | **not** via the key set — `refreshReport` invalidates and repopulates it directly |

`GET /expense/search` and `GET /expense/expense-edit-data` are **not** cached server-side,
so neither can go stale.

**TanStack Query.** All three of API-05/06/07 issue the identical four calls:

| Prefix | Covers |
|---|---|
| `queryKeys.expenses.all` = `["expenses"]` | `expenses.lists()`, every `expenses.list(filters)` variant, and `expenses.detail(id)` |
| `queryKeys.budgets.all` = `["budgets"]` | `useBudgetsQuery`, `useBudgetSummary` |
| `queryKeys.reports.all` = `["reports"]` | the report page and insight panels |
| `queryKeys.charts.all` = `["charts"]` | `charts.bar`, `charts.trend`, `charts.pie`, `charts.loggedYears` |

`queryKeys.income.*` is deliberately untouched: no income query reads expense data.

## D. ML prediction dependency inventory

| Trigger | Caller | Endpoint/service | Input | Output | Confidence/fallback | Cancellation/race handling | Persistence effect |
|---|---|---|---|---|---|---|---|
| Typing the expense name, ≥ 3 chars, after a 500 ms debounce | `AddExpense.js` prediction `useEffect`, via bare `window.fetch` | `POST /ml/predict-category` → `${ML_ROUTE}/predict-category` | `{ expenseName }` | `{ expenseName, cleanedText, predictedCategory, confidence }` | Confidence displayed, never thresholded. On any failure the field is simply left empty | `AbortController`; the effect cleanup aborts the previous request, and `AbortError` is swallowed | **None.** Writes into React state only |
| Empty description at submit | `addexpense.js`, server-side via axios | `${ML_ROUTE}/generate-description` | `{ expenseName, expenseCategory, expenseAmount }` | `{ description }` | 5 s timeout; on failure the description becomes `""` | None needed — inside one request | Stored on the expense as `expenseDescription` |

| Question | Answer |
|---|---|
| Create, edit or both? | **Create only in practice.** The effect is mode-agnostic, but an edit-loaded name is suppressed by `programmaticNameRef` until the user types |
| Debounced? | Yes — 500 ms |
| Trigger field | `expenseName`, and nothing else |
| Stale responses prevented? | **Yes** — the aborted request cannot resolve into state |
| Cancellable? | Yes, including on unmount |
| Confidence used? | Displayed only. No cut-off, no styling change, no warning |
| User override? | Always. Plain text input, never disabled |
| Failure blocks submit? | No |
| Predicted category persisted automatically? | Only if the user submits with it still in the field |
| Why bill prefill bypasses prediction | `programmaticNameRef.current` is set to the bill's name, so the effect's first guard returns before requesting — protecting the receipt-derived values from being overwritten |
| Any *other* programmatic name change that bypasses it? | Yes — the edit hydration uses the same ref, deliberately. Those are the only two writers. A user typing the identical string cannot reach that state, because reaching a different name first nulls the ref |

**Ownership.** `/ml/predict-category` lives in `backend/Routes/ml.router.js` on the `/ml`
mount, and its purpose is prediction rather than expense management. It is **not counted
as an Expense API** — it now has its own dedicated document,
[ML-API-11](../ml-service/ml-api-11-backend-predict-proxy.md), in the ML Service module,
since that module already owns the FastAPI side of the same prediction round trip. The
model, training data and confidence calibration remain fully documented under the ML
module.

## E. Resolved gap — the fifth read endpoint

`GET /expense/expense-edit-data` previously had no API document of its own — it is a
**retrieval** route, not one of the four originally-approved viewing APIs, because it
backs the edit form rather than the viewing experience. During the repository-wide API
coverage gate this was identified as a genuine violation of the
one-document-per-endpoint rule (a real, reachable, application-defined endpoint cannot
be covered by cross-linking from a flow alone) and closed with its own document,
[API-09](api-09-edit-data.md). Its full behaviour remains cross-referenced from
[FLOW-02 §5](flow-02-retrieval-assisted-edit.md#5-api-dependencies) as the combined
retrieval-then-edit journey, but FLOW-02 is not API-09's coverage — API-09 is.

| | |
|---|---|
| Route | `router.get('/expense-edit-data', verifyToken, geteditexpense)` |
| Guards | ObjectId `isValid` → 400; scoped `findOne` → 404 |
| Redis | none |
| Client cache | `expenses.detail(id)`, `staleTime` 5 min |
| Status | Actively used — now documented as [API-09](api-09-edit-data.md) |

## F. Non-endpoint expense writes

| Source | What it does | Cache behaviour |
|---|---|---|
| `backend/cron/recurringJob.js`, `30 20 * * *` | Claims each due `RecurringExpense` atomically, then `ExpenseModel.create(...)` with `id: crypto.randomUUID()` and `expenseDescription: "Auto logged recurring expense"` | **Correct** — calls `recalculateBudget`, `clearUserExpenseCache` and `refreshReport`, each wrapped so a propagation failure cannot abort the run |

This is the only expense write outside the four endpoints. It is listed for completeness;
the recurring subsystem itself is not part of this batch.

## G. Layers that do not exist

Stated explicitly, because their absence shapes the module:

- No bulk create, update or delete endpoint
- No soft delete, archive, restore or undo
- No transaction anywhere — API-08 performs two writes, and both flows span two requests
- No optimistic concurrency: nothing carries a version or compares `updatedAt`
- No validation middleware on `PUT`, `DELETE` or `PATCH`
- No server-side length limit on any string field
- No category enum — any string is a valid category
- No conflict detection between tabs
- No cleanup of `RecurringExpense` or `Notification` rows when an expense is deleted
- No cache invalidation of any kind on `PATCH /api/recurring`
