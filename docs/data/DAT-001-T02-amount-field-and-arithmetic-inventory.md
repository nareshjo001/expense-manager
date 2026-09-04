# DAT-001-T02: Amount field and arithmetic-path inventory

Inventories every monetary field in the schema and every place the
codebase does arithmetic on money, so DAT-001-T03 (central money
parsing/formatting helpers) targets real call sites instead of guessing,
and DAT-001-T04's shadow-field migration knows every write path a new
minor-unit field would need to mirror. See
[ADR-0003](../decisions/ADR-0003-money-representation.md) for the target
representation (integer paise) this inventory feeds into.

## 1. Every monetary field in the schema

All four money-bearing schemas live in one file, `backend/config/Schemas.js`
(not `backend/models/` -- the only monetary model outside that file is
`RecurringExpense`).

| Field | Schema (file) | Mongoose type | Notes |
|---|---|---|---|
| `expenseAmount` | `expenseSchema` (`config/Schemas.js`) | `Number` | Core transaction amount. `required: true`, no min/max bound today. |
| `incomeAmount` | `IncomeSchema` (`config/Schemas.js`) | `Number` | Core income amount. `required: true`, no min/max bound today. |
| `budget` | `budgetSchema` (`config/Schemas.js`) | `Number` | User-set monthly budget target. `min: 0, required: true`. |
| `spent` | `budgetSchema` (`config/Schemas.js`) | `Number` | Recalculated aggregate of the month's `expenseAmount`s, not user-entered. `min: 0, required: true`. |
| `expenseAmount` | `RecurringExpenseSchema` (`models/RecurringExpense.js`) | `Number` | Template amount copied into a new `expenses` document each time the recurring job materializes an occurrence. |

`mlConfidence` (`expenseSchema`) and `confidence` (`MlFeedbackSchema`) are
also `Number` but are model-confidence scores (0-1), not money -- excluded
from this inventory on purpose.

All five fields above are IEEE-754 floating point today (Mongoose
`Number`), which is exactly the representation
[ADR-0003](../decisions/ADR-0003-money-representation.md) already decided
to move away from in favor of integer minor units (paise).

## 2. Where the amount is first produced (entry points)

| Entry point | File | How the value enters |
|---|---|---|
| Manual expense entry | `Controllers/ExpenseControllers/addexpense.js`, `editExpense.js` | Client-submitted number, validated at the route boundary. |
| Manual income entry | `Controllers/IncomeControllers/addincome.js`, `editIncome.js` | Client-submitted number. |
| Manual budget entry | `Services/BudgetServices/budget.service.js` (`setBudgetForCurrentMonth`) | Client-submitted `budgetAmount`, written via `$set`. |
| Receipt OCR | `Services/BillServices/receiptParser.js:27` | `parseFloat(...)` extracting an amount out of OCR-recognized receipt text -- the least trustworthy entry point: unvalidated text parsed straight to a float, no bounds/NaN guard visible at this call site. The most likely place a malformed/adversarial amount enters the system. |
| Recurring materialization | `cron/recurringJob.js:83`, `Controllers/RecurringExpenses/recurring.js:59` | Straight field copy (`expenseAmount: recurring.expenseAmount`) from the `RecurringExpense` template into a new `expenses` document -- no arithmetic, but a round-trip path that must preserve the value exactly. |

## 3. Arithmetic paths, by category

### 3a. Mongo-side aggregation (`$sum` in an aggregation pipeline)

Summation happens inside MongoDB, not JS, in these paths -- a distinct
execution context from 3b that a future minor-unit migration must handle
separately (integer paise sums correctly in `$sum`; today's float amounts
can accumulate floating-point drift across many documents):

- `Services/BudgetServices/budget.service.js:58` -- `recalculateBudget()`:
  `{ $group: { _id: null, total: { $sum: "$expenseAmount" } } }`, then
  written back via `$set: { spent: spentAmount }` (lines 76, 90). This is
  the one path that **writes** a derived amount (`spent`) back to the
  database, not just reads one.
- `sia/financialQueryService.js:57,92` -- two separate aggregation
  pipelines summing `$expenseAmount`, one overall and one grouped by
  `$expenseCategory`, for SIA's natural-language financial answers.

### 3b. JS-side reduce/accumulate over fetched documents

The dominant pattern: fetch documents, then sum client-side with
`Array.prototype.reduce` or a running `+=`. Found in at least:

- `Services/ChartServices/chart.service.js` -- yearly total (line 22),
  monthly totals accumulator (line 35), per-category totals (lines 49,
  62), and a year x month grid accumulator (line 152).
- `Services/HelperServices/getexpense.service.js:46` -- weekly totals.
- `Controllers/IncomeControllers/insightsCard.js:46-47` and
  `insightsHeader.js:45-46` -- total income and total expenses, computed
  independently in both files rather than shared.
- `analytics/analyticsContext.js:64` -- current-month expense total.
- `analytics/forecastInputAggregator.js:72` and
  `analytics/currentMonthForecastInputAggregator.js` -- monthly
  history series for forecasting.
- `analytics/analyzers/categoryAnalyzer.js` -- category totals, max/min
  category, concentration index (sum of squared percentage shares),
  top-N share -- five separate `reduce()` calls in one file.
- `analytics/analyzers/categoryForecastAllocator.js` -- multiple
  reduce-based sums when reconciling a per-category forecast allocation
  back to a target total (see 3d below).
- `analytics/analyzers/currentMonthForecastAnalyzer.js:180,183` --
  summing excluded-adjustment amounts.

### 3c. Direct subtraction / comparison

- `Services/ChartServices/chart.service.js:104` -- budget remaining:
  `Math.max(0, budgetDoc.budget - budgetDoc.spent)`.
- `analytics/analyzers/currentMonthForecastInputAggregator.js` -- robust
  statistics on amounts (median, MAD, modified z-score) for anomaly
  detection (lines ~12-15, 169-177) -- not the authoritative value, but
  arithmetic performed directly on parsed amounts.

### 3d. Rounding -- the clearest existing duplication

**The same two-decimal rounding helper is independently redefined in at
least 12 files**, all with the identical body:

```js
const round2 = (value) => Number(Number(value).toFixed(2));
```

Files: `analytics/analyzers/budgetAnalyzer.js`,
`categoryAnalyzer.js`, `categoryForecastAllocator.js`,
`currentMonthForecastAnalyzer.js`, `expenseAnomalyAnalyzer.js`,
`forecastAnalyzer.js`, `forecastBudgetRisk.js`, `habitAnalyzer.js`,
`spendingAnalyzer.js`, `trendAnalyzer.js`,
`analytics/currentMonthForecastInputAggregator.js`,
`analytics/forecastInputAggregator.js`.

A separate, differently-shaped rounding pattern also appears independently
in `sia/financialQueryService.js` (`Math.round(row.total * 100) / 100`,
lines 63, 80, 101) -- same intent, different implementation, a third
variant of "round to 2dp" nobody shares.

This is the single strongest, most quantifiable argument for
DAT-001-T03's central helper: one shared `roundMoney()`/formatter would
delete at least 13 duplicate definitions across `analytics/` and `sia/`.

### 3e. Integer-minor-unit arithmetic that already exists

`analytics/analyzers/categoryForecastAllocator.js:65,73` already converts
to paise internally for one specific purpose -- distributing a rounded
forecast total across categories without losing or double-counting a
paisa to floating-point rounding (`targetPaise = Math.round(targetTotal *
100)`, then a largest-remainder-style distribution of `floorPaise` per
category). This is a working, in-the-wild precedent for the
integer-minor-unit approach ADR-0003 already chose for the real money
fields -- DAT-001-T03/T04 can study this allocator's technique rather
than inventing the rounding-remainder logic from scratch.

## 4. Summary for DAT-001-T03

- **5 schema fields**, all currently `Number` (float), across 2 files
  (`config/Schemas.js`, `models/RecurringExpense.js`).
- **1 entry point with no visible validation boundary**:
  `receiptParser.js`'s `parseFloat()` on OCR text -- the highest-priority
  boundary to harden when the central parsing helper lands.
- **1 write-back-of-a-derived-amount path**: `budget.service.js`'s
  `spent` recalculation -- the one place a derived total round-trips back
  into the authoritative store, so it is the one place a minor-unit
  migration changes both a read and a write.
- **At least 13 independent re-implementations of "round to 2 decimal
  places"** across `analytics/` and `sia/` -- the concrete, countable
  target for a shared money-rounding helper.
- **Two distinct summation execution contexts** (Mongo `$sum` vs. JS
  `reduce()`) that both need to agree once fields move to integer minor
  units, plus one existing integer-paise precedent
  (`categoryForecastAllocator.js`) to build the new helpers around.
