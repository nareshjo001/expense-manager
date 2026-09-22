# EXP-002-T03/T04: Normalized/searchable fields decision, and the indexed query service

Combined into one document because T03's own task ("add normalized/
searchable fields only where justified") is explicitly deferred, in
[EXP-002-T01's contract doc](EXP-002-T01-filter-contract-and-combinations.md),
to whatever T04 finds when it actually builds the query -- the two are one
decision, not two.

## T03: no new normalized/searchable field is added

The candidate would have been a lowercased `expenseNameLower` shadow field
on `expenseSchema`, to make `nameContains` sargable via a B-tree index
prefix, the same shape `merchantKey` already gives
`MerchantCategoryRule` for exact-key lookups.

**Decision: do not add it.** Reasoning, not measurement -- there is no live
production MongoDB available to this task to run a real `.explain()`
against representative data, so this is the same kind of documented,
reasoned default this codebase has already used elsewhere for a decision
that would ordinarily want live evidence (ADR-0005's RPO/RTO numbers,
ADR-0007's grace period). What IS verifiable without live data is the
query shape MongoDB's planner will execute, from the schema/index
structure DAT-002-T01 already inventoried:

- `startDate`/`endDate` are REQUIRED on every search request (not
  optional, unlike the four new filters) and are now capped at
  `MAX_PERIOD_SPAN_DAYS` (366 days, EXP-002-T02). Every query this
  endpoint ever runs therefore always includes `{ userId, expenseDate:
  {$gte, $lte} }`, which the EXISTING `expenseSchema.index({ userId: 1,
  expenseDate: 1 })` compound index (confirmed present in
  `config/Schemas.js` by DAT-002-T01's inventory) serves as an index
  range scan, not a collection scan.
- `nameContains`, `category`, `minAmount`/`maxAmount`, and `isRecurring`
  are all OPTIONAL, AND-combined (EXP-002-T01), and applied as additional
  predicates MongoDB filters within the already-narrowed candidate set
  the index range scan produced -- standard behavior for a query that
  matches a compound index's prefix plus extra non-indexed conditions.
- This is a solo personal-finance app (BALENISA), not a multi-tenant
  product with unbounded per-user row counts. A single user's expense
  count within any 366-day window is the realistic bound on how large
  that per-scan candidate set gets, not the whole collection.

Given that, an unanchored substring regex filter (`nameContains`)
evaluated over an already date-range-bounded, single-user candidate set is
a reasonable cost, and adding a denormalized shadow field now -- with its
own migration, backfill, and dual-write maintenance burden (the exact
kind DAT-001's `expenseAmountMinor` precedent shows is real, ongoing
work) -- is not justified by anything currently measured. This is a
DEFAULT, not a permanent ruling: if usage ever shows this endpoint is
slow in practice, `DAT-003`'s migration framework is the established path
to add a normalized field then, backed by a real `.explain()` from actual
data instead of this document's reasoning.

`category` needs no new field at all: EXP-002-T01 already established it
reuses `categoryNormalization.js`'s existing write-time normalization
(`expenseCategory` is stored already-canonical, confirmed by reading
`addexpense.js`/`editExpense.js`), so the filter only has to normalize the
INCOMING query value the same way (`normalizeCategoryForGrouping`, the
existing read-boundary wrapper) and exact-match -- no substring search, no
index concern beyond what the date-range scan already bounds.

## T04: the indexed query service

New `Services/ExpenseServices/expenseSearchService.js`, extracted out of
`getbycustom.js` rather than left inline, both because "create indexed
query service" names it as its own module and because the filter-building
logic is now non-trivial enough (4 optional predicates, normalization,
regex escaping) to warrant a dedicated, independently-testable unit,
matching this codebase's existing separation (`sia/financialQueryService
.js`, `Services/RecurringServices/recurringStateService.js`).

`buildExpenseSearchFilter(userId, { startDate, endDate, nameContains,
category, minAmount, maxAmount, isRecurring })` returns the Mongo filter
object; `searchExpenses(...)` wraps it with the existing cursor-pagination
helpers (`utils/pagination.js`), reusing them exactly as
`getByCustomPaginated` already does -- EXP-002-T01 already confirmed no
pagination redesign is needed, and this task does not revisit that.

Field-name reuse, confirmed by reading `config/Schemas.js` directly:
`expenseName` for `nameContains`, `expenseCategory` for `category`
(post-normalization), `expenseAmount` for the amount range (the
authoritative float field, NOT `expenseAmountMinor` -- T01 already ruled
this out explicitly), `isRecurring` for the boolean flag.

`nameContains` uses a case-insensitive regex (`$options: 'i'`), with the
user-supplied string run through a local `escapeRegExp()` first -- every
regex metacharacter escaped so the filter can never be abused as an
unintended pattern (ReDoS surface or an unintended broader match). No
shared `utils/escapeRegExp` existed outside `sia/financialQueryService
.js`'s own private copy (confirmed by grep across `utils/`, `Services/`,
`Controllers/`); this service gets its own, matching the "no import
across the SIA-controllers-only boundary" decision T02 already made for
`MAX_PERIOD_SPAN_DAYS`.

`getbycustom.js` is updated to call this service instead of building the
filter inline, and to read the four new (already-validated by T02)
optional query params. The controller's own required-field/valid-date
checks and pagination-error handling are unchanged.
