# BUD-001-T01: Category budget and total-budget invariants

Defines the rules every other BUD-001 task implements against: the schema
(T02), CRUD/reconciliation services (T03), threshold/risk facts (T04), UI
(T05), notifications (T06) and tests (T07). Each invariant is stated once
here and enforced in one place in code, named next to it.

## 1. Current state (verified, not assumed)

- The only budget today is a single monthly total: `BudgetModel`
  (`backend/config/Schemas.js`), one document per `{userId, month}` (unique),
  `month` stored as a locale-formatted `"MMM YYYY"` key produced by
  `Services/BudgetServices/budget.service.js`'s `getMonthKey()`. `spent` is a
  persisted, derived field recomputed by `recalculateBudget()` through
  `syncRecoveryService.synchronizeAfterMutation()` after every expense or
  budget mutation.
- Expenses carry `expenseCategory`, normalized at every write boundary by
  CAT-001's `utils/categoryNormalization.js` (`normalizeCategory`). Legacy
  documents may predate normalization, which is why read/aggregation paths
  use `normalizeCategoryForGrouping` (invalid values fall into the explicit
  `Uncategorized` bucket instead of throwing or being dropped).
- Status tiers already exist: `analytics/analyzers/budgetAnalyzer.js`'s
  exported `STATUS_THRESHOLDS` (Safe <= 70%, Warning <= 90%, Critical <= 100%,
  Overspent > 100%).
- Money: ADR-0003 / `utils/money.js` (`toMinorUnits`, `roundMoney`,
  `parseAmountInput`). Integer paise are the arithmetic unit.

## 2. Invariants

| # | Invariant | Enforced in |
|---|---|---|
| I1 | **Optional and additive.** Category budgets never replace or modify the total monthly budget. `BudgetModel` and its endpoints are untouched. A month may have category budgets with or without a total. | Separate collection (`models/CategoryBudget.js`) |
| I2 | **Identity.** At most one allocation per `(userId, month, category)`. `month` is canonical `"YYYY-MM"` (locale-independent, sortable -- deliberately not the legacy `"MMM YYYY"` key, which is only derived for the total-budget lookup). `category` is `normalizeCategory(raw)`, the same write-boundary normalizer expenses use, so a budget for `"food"` and an expense in `"Food"` meet on the same key. | Unique index; `categoryBudgetContract.normalizeBudgetCategory` |
| I3 | **Category validity.** `null` from `normalizeCategory` is rejected (`INVALID_CATEGORY`). `"Uncategorized"` is reserved as the read-side bucket for invalid legacy data and cannot be budgeted (`RESERVED_CATEGORY`). Max 50 characters after normalization. Unknown categories are allowed -- CAT-001 categories are not an allowlist. | `categoryBudgetContract.normalizeBudgetCategory` |
| I4 | **Amount.** Parsed with `parseAmountInput`; must be `> 0` (a zero budget is expressed by deleting the allocation) and `<= 1,000,000,000` rupees; at most 2 decimal places (rejected, never silently rounded). Stored as both `amount` (rupees) and `amountMinor` (integer paise); all arithmetic uses `amountMinor`. | `categoryBudgetContract.parseBudgetAmount` |
| I5 | **Bounded count.** At most 25 category budgets per user per month (`TOO_MANY_CATEGORY_BUDGETS`). | Service, on create only (an update of an existing allocation never counts against the cap) |
| I6 | **Write window.** Writes (create/update/delete) are allowed for the current month and up to 11 months ahead. Past months are read-only, preserving history. Reads accept any valid month `2000-01`..`2099-12`. | `categoryBudgetContract.isWritableMonth` |
| I7 | **Total-budget reconciliation.** `allocatedMinor = sum(amountMinor)` for the month. If a total budget exists for that month, a category write that would make `allocatedMinor > totalBudgetMinor` is rejected with `CATEGORY_BUDGET_EXCEEDS_TOTAL` (HTTP 409). The reverse is deliberately **not** enforced: editing the total budget is never blocked by category allocations (existing total-budget endpoints are unchanged). If the total later drops below the allocations, the summary reports `overAllocated: true` and `overAllocatedByMinor`. `unallocatedMinor = max(0, total - allocated)` when a total exists, else `null`. | Service (write check); analyzer (reporting) |
| I8 | **Concurrency of I7.** The check-then-write is not atomic across documents: two concurrent writes for different categories could each pass the check. After every successful write the service re-reads the month's allocated sum; if it now exceeds the total, it compensates (restores the previous amount, or deletes a newly created allocation) and returns `CATEGORY_BUDGET_EXCEEDS_TOTAL`. | Service |
| I9 | **Spent is derived, never stored.** `spentMinor` for a category = sum of that month's expenses (same `getMonthRange` boundaries the total budget uses) whose `normalizeCategoryForGrouping(expenseCategory)` equals the budget's category. Expenses in categories with no budget are reported in aggregate as `unbudgetedSpentMinor`. | `categoryBudgetSpend.aggregateSpentByCategory` |
| I10 | **Status tiers.** `utilization = spentMinor / amountMinor * 100` (2 dp); status via `budgetAnalyzer.STATUS_THRESHOLDS` (not re-declared). | `categoryBudgetContract.statusFor` |
| I11 | **Rollover: none.** Each month is independent. Unspent amounts never carry forward, overspend never reduces the next month. Every summary response states `rolloverPolicy: "none"` so the UI can say so explicitly. | Contract constant |
| I12 | **Idempotency.** Create/update is a single upsert keyed on `(userId, month, category)`, so a replayed request converges on the same state. Delete is by id; a replayed delete returns `CATEGORY_BUDGET_NOT_FOUND` (404) deterministically. | Service |
| I13 | **Ownership.** `userId` comes only from the verified token; every query is scoped by it; any client-supplied `userId` is ignored. Another user's id and a nonexistent id return the same 404, so existence cannot be inferred. | Service/controllers |
| I14 | **Alerts (T06).** Alert levels: `0` none, `1` entered Critical (> 90%), `2` Overspent (> 100%). Each level notifies at most once per allocation (`lastAlertLevel` on the document, advanced with an atomic conditional update so concurrent mutations cannot double-send). Changing an allocation's amount resets `lastAlertLevel` to `0`. Alerts respect the user's notification preferences for the registered `category-budget-alert` type and never affect the outcome of the expense write that triggered them. | Alert service |
| I15 | **Deletion and retention.** Kept for the life of the account (same as `BudgetModel`); removed by the account-deletion orchestrator's Tier-B steps. | `accountDeletionTierBSteps.js` |
| I16 | **Versioned responses.** Every category-budget response carries `contractVersion: 1`. | Controllers |

## 2a. Refinements made during implementation (2026-09-26)

These refine the invariants above. They came out of implementation and
review, and each is enforced and tested.

- **I4 (amount precision).** The "at most 2 decimals" check counts decimals
  on the text for string input (trailing zeros ignored, so `"1500.500"` is
  valid) and allows only float-representation noise for numeric input. The
  first version used a fixed float tolerance, which rejected valid 2-dp
  amounts above about 13.4 crore rupees.
- **I7 (reconciliation).** Only a write that *increases* an allocation is
  checked against the total. Lowering or keeping an allocation is always
  allowed, so a user whose month became over-allocated (because the total
  was lowered) can always reduce allocations step by step. I8's
  compensation likewise only undoes a write that increased the amount, and
  only if the document still holds that request's value, so a newer write
  is never overwritten.
- **I10 (status).** Status and alert level are classified from the *exact*
  integer ratio (`spentMinor * 100 <= max * amountMinor`,
  `statusForMinor` / `alertLevelForMinor`), not from the 2-dp rounded
  `utilization`. Spend of 1 paisa over a large allocation rounds to 100.00%
  but is `Overspent`. `utilization` is a display value only.
- **atRisk.** Only a month still in progress can be `atRisk`. A closed month's
  projection equals its actual, so flagging it would describe a risk that can
  no longer be acted on.
- **I14 (alerts).** Alerts are evaluated for the **current month only**. A
  future month has no spend yet, and a past month is closed. Without this, a
  historical import (which passes many past dates) would send alerts about
  months the user can no longer do anything about. Generic-preview pushes
  for this type say "You have a new budget alert.", never the category or
  percentage (`push.service.js` previously showed every generic push as
  "A recurring expense was added.").
- **Post-write summary.** If building the fresh summary fails *after* a
  successful upsert/delete, the response is still `200` with
  `summary: null`. A 500 would invite a retry, and a retried delete would
  then return a misleading 404.
- **409 UX.** The category-budget PUT opts out of the shared axios
  interceptor's generic 409 toast (`suppressConflictToast`) because the UI
  shows the specific reason inline. 401/429 handling is unchanged.

## 3. API contract

All routes are mounted on the existing authenticated `/api` router
(`verifyToken`, `apiLimiter`). Error responses follow the existing
`{ success: false, message, errorCode, field? }` shape.

| Method | Path | Body / query | Success |
|---|---|---|---|
| GET | `/api/category-budgets?month=YYYY-MM` | `month` optional (defaults to current month) | `200 { success, contractVersion, data: <summary> }` |
| PUT | `/api/category-budgets` | `{ month, category, amount }` | `200 { success, contractVersion, data: { budget, summary } }` (`created: true/false` on `budget`) |
| DELETE | `/api/category-budgets/:id` | -- | `200 { success, contractVersion, data: { deletedId, summary } }` |

`<summary>` shape (produced by `analytics/analyzers/categoryBudgetAnalyzer.js`):

```text
{
  month: "YYYY-MM",
  writable: boolean,
  rolloverPolicy: "none",
  asOfDate: ISO string,
  totals: {
    totalBudgetMinor: int | null,      // null when no total budget is set
    allocatedMinor: int,
    unallocatedMinor: int | null,
    overAllocated: boolean,
    overAllocatedByMinor: int,         // 0 when not over-allocated
    budgetedSpentMinor: int,
    unbudgetedSpentMinor: int,
    totalSpentMinor: int
  },
  categories: [                        // sorted by utilization desc, then category asc
    {
      id, category,
      amountMinor, spentMinor, remainingMinor,   // remaining may be negative
      utilization,                     // number, 2 dp
      status: "Safe"|"Warning"|"Critical"|"Overspent",
      projectedSpentMinor: int | null, // straight-line pace to month end; null for future months
      projectedStatus: status | null,
      atRisk: boolean                  // projectedStatus in {Critical, Overspent} while status is not already Overspent
    }
  ],
  unbudgetedCategories: [ { category, spentMinor } ]   // sorted by spentMinor desc
}
```

Error codes: `INVALID_MONTH`, `MONTH_NOT_WRITABLE`, `INVALID_CATEGORY`,
`RESERVED_CATEGORY`, `INVALID_AMOUNT`, `AMOUNT_OUT_OF_RANGE`,
`TOO_MANY_CATEGORY_BUDGETS`, `CATEGORY_BUDGET_EXCEEDS_TOTAL` (409),
`CATEGORY_BUDGET_NOT_FOUND` (404), `INVALID_ID`.

## 4. Explicitly out of scope

- Copying last month's allocations forward (a convenience action, not a
  rollover). Possible follow-up; it would be an explicit user action and
  would not change I11.
- Including category budgets in DAT-004 data export (follow-up; noted so it
  is not silently forgotten).
- Wiring category-budget facts into the cached `FinancialReport` document.
  Facts are computed live per request instead, which avoids a report
  contract version bump and avoids persisting recomputable values.
