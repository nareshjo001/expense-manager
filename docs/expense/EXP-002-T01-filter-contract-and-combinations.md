# EXP-002-T01: Filter contract and supported combinations

Defines which filters `GET /expense/search` will support, how they combine,
their value/format contract, and how they interact with the cursor
pagination EXP-003 already shipped -- so EXP-002-T02 (strict validation)
through T04 (indexed query service) have a concrete, agreed-on contract to
implement against instead of each task inventing its own shape. This is a
design/definition task: **no code changes are part of this task**, matching
the same scope discipline as DAT-002-T01 and PRV-001-T01.

## 1. Current state (verified against the real implementation)

`GET /expense/search` (`backend/Controllers/GetExpenseControllers/
getbycustom.js`) today accepts exactly `startDate`, `endDate` (both
required), plus EXP-003's `limit`/`cursor` pagination pair. No merchant
name, category, amount range, or recurring-only filter exists on this or
any other expense-listing route -- confirmed by reading `getbycustom.js`,
`fetchExpenses.js`, and `getbycategory.js` in full, and by grepping
`frontend/src` for existing filter UI (found only a period/mode selector
--`filter`/`period` state in `ExpensesPage.js` choose BETWEEN last-week /
by-category / custom-range views, not a real multi-field filter). This
matches the 2026-09-08 forensic audit note in the feature file verbatim.

**Also confirmed, a real gap this task surfaces (not previously
documented):** `getbycustom.js` validates that `startDate`/`endDate` are
present and parseable, but enforces **no maximum span** between them --
a request for `startDate=2000-01-01&endDate=2030-01-01` is accepted
as-is (each page is still bounded by `limit`, but the number of pages a
client could page through is not). `backend/sia/financialQueryService.js`
already established a precedent for this exact problem
(`MAX_PERIOD_SPAN_DAYS = 366`, "mirrors the 12-month history ceiling") for
a different endpoint family (SIA's financial-query helpers) -- section 4.1
recommends reusing that same ceiling here for consistency, rather than
EXP-002-T02 picking an unrelated number.

## 2. Existing abstractions this contract is designed to reuse, not replace

- **Cursor pagination** (`backend/utils/pagination.js`, EXP-003):
  `resolveLimit`/`decodeCursor`/`buildCursorFilter`/`paginateResults`,
  keyset-paginated on `(expenseDate DESC, _id DESC)`. Section 5 covers
  exactly how new filters compose with this without changing it.
- **Category normalization** (`backend/utils/categoryNormalization.js`,
  CAT-001): categories are explicitly **not an allowlist** --
  `normalizeCategory()`'s own doc comment states an unknown category is
  preserved, never rejected. A category filter must therefore accept ANY
  string a user has actually stored, not validate against
  `CANONICAL_CATEGORIES`.
- **Merchant normalization** (`backend/utils/merchantNormalization.js`,
  CAT-001): `normalizeMerchantKey()` is an EXACT-match lookup key
  (lowercase + collapsed whitespace) built for merchant-category-rule
  lookups, not a search index -- confirmed by reading the file directly.
  It is the wrong tool for a "search by name" filter (a user typing
  "starbucks" expects to match "Starbucks Coffee #42", not require an
  exact stored value), so section 3.2 defines search semantics
  separately rather than reusing this function for a different purpose
  than it was built for.
- **Money handling** (`backend/utils/money.js`, DAT-001): `expenseAmount`
  is the authoritative float field today; `expenseAmountMinor` is an
  optional, flag-gated shadow field (DAT-001-T04/T06) not guaranteed
  populated on every document (only written when
  `MONEY_MINOR_DUAL_WRITE_ENABLED=true`, and only backfilled where a
  migration has run). Section 3.3 filters against `expenseAmount`
  accordingly, not the shadow field.
- **`isRecurring`** (`expenseSchema`, already indexed nowhere on its own
  today per DAT-002-T01's index inventory, but present on every
  document): a plain boolean, exact-match filter, no normalization
  needed.
- **`annotateRecurringState`**
  (`Services/RecurringServices/recurringStateService.js`): already runs
  on every `getByCustom` result page today; unaffected by any filter
  added here since it operates on the returned page, not the query.

## 3. Supported filter fields

Every filter below is **optional** except the existing required date
range. All present filters combine with **AND** semantics only (see
section 4 for why OR is explicitly out of scope for this iteration).

### 3.1 Date range (`startDate`, `endDate`) -- required, unchanged

Already implemented and validated (presence + parseable `Date`). This
task does not change its shape; T02 adds the missing max-span bound
(section 1's gap, recommendation in 4.1).

### 3.2 Merchant/name search (`nameContains`, new)

Case-insensitive **substring** match against `expenseName` -- matches
"search" as a product concept ("find that Starbucks charge"), not an
exact-key lookup. Deliberately named `nameContains`, not `merchant` or
`name`, so the contract itself states the match semantics rather than
leaving them to be inferred from the parameter name.

**Open design question, flagged for T03/T04 rather than resolved here:**
an unanchored substring match (`$regex: text, $options: 'i'`, no `^`
anchor) cannot use a standard B-tree index -- it forces a collection
scan within whatever the date-range/other-filter predicates already
narrowed the query to. For this codebase's actual scale (a personal
expense tracker, not a multi-tenant SaaS with millions of rows per user)
this is very likely fine bounded by the required date range, but it is a
real tradeoff T04 ("create indexed query service") needs to explicitly
accept or revisit -- e.g. a MongoDB Atlas Search / text index if scale
ever demands it. T01 intentionally does not pre-decide an indexing
strategy; it only fixes the match *semantics* (case-insensitive,
substring, single field) so validation (T02) and the query layer (T04)
build against the same contract.

Bound: request rejected (T02) if `nameContains` is present but empty
after trimming, or exceeds a reasonable length ceiling (recommend 200
characters, matching `normalizeMerchantKey`'s own
`MAX_MERCHANT_KEY_LENGTH` for consistency even though this is a
different function).

### 3.3 Category (`category`, new)

Case-insensitive **exact** match against `expenseCategory`, using the
SAME normalization pass `categoryNormalization.js` already applies at
write time (so a user searching `"food"` matches documents stored as
`"Food"`). Accepts any string, including one outside
`CANONICAL_CATEGORIES` -- consistent with categories being dynamic, not
an allowlist, per that module's own documented contract. Reuse
`normalizeCategory()` (or the equivalent read-side comparison it already
enables elsewhere) rather than re-implementing comparison logic in the
query layer.

Multi-category selection (e.g. "Food OR Groceries") is explicitly a
**non-goal for this iteration** -- see section 4.

### 3.4 Amount range (`minAmount`, `maxAmount`, new)

Numeric range filter against `expenseAmount` (the authoritative float
field -- see section 2's money-handling note for why not
`expenseAmountMinor`). Both bounds optional and independent: either
alone is a valid one-sided range (`minAmount` only = "at least this
much"), both together is an inclusive range, neither present means no
amount filtering.

Validation contract for T02: both values must be finite, non-negative
numbers (an expense amount is never negative in this schema -- confirmed
by `expenseSchema.expenseAmount` having no `min` bound today, but no
negative-amount write path exists anywhere in the codebase either); when
both are present, `minAmount <= maxAmount` (reject the inverted case
rather than silently swapping it, matching this codebase's established
"tell the client about its own mistake" pattern from
`resolveLimit()`/`parseLimit()`'s validation philosophy).

### 3.5 Recurring only (`isRecurring`, new)

Exact boolean match against the existing `expenseSchema.isRecurring`
field. Absent means "no filtering on this dimension" (both recurring and
non-recurring expenses returned), not "false" -- an important distinction
T02 must preserve: a query-string boolean parser that treats a missing
parameter the same as `isRecurring=false` would silently exclude every
recurring expense from the unfiltered default view, a real, easy mistake
to make and worth calling out explicitly here so it is not one.

### 3.6 Explicitly out of scope -- not user-facing filters

`mlPredictedCategory`, `mlConfidence`, `wasMlCorrected`, `wasMlAbstained`
(all on `expenseSchema`) are internal ML bookkeeping fields, not
something a user searching their own expense history has a reason to
filter by. Confirmed by reading every field on `expenseSchema`
(DAT-002-T01's inventory already enumerated all of them) -- these four
are the only fields on the schema besides the ones named above and the
identity fields (`userId`, `id`, `expenseDescription`), and
`expenseDescription` itself is also left out of `nameContains`'s scope
deliberately (searching free-text notes is a different, larger feature
than "find this transaction by merchant name," and conflating the two
would silently change what a `nameContains` match means without the
product deciding to).

## 4. Supported combinations

Every filter in section 3 (3.2-3.5) is **independently optional and
freely combinable with every other one, ANDed together**, on top of the
always-required date range. This is the smallest combination rule that
satisfies the feature's stated goal ("provide... filters with clear...
combinations") without inventing a query-builder UI this task was never
asked to design.

**Explicitly out of scope for this iteration (a deliberate non-goal, not
an oversight):**

- **OR combinations** across filter types (e.g. "Food or Travel", "this
  merchant or that merchant") -- would require either a multi-value
  parameter contract (`category[]=Food&category[]=Travel`) or a small
  query-expression language, either of which is a meaningfully bigger
  scope than "filters with clear combinations." If a future task wants
  this, it should be scoped as its own EXP-002 follow-up task, not
  silently folded into T02-T04's implementation of THIS contract.
- **Filtering by a range on a non-indexed derived value** (e.g. "expenses
  where the recurring occurrence is overdue") -- no such derived field
  exists on `expenseSchema` today; out of scope until one does.

## 5. Interaction with cursor pagination -- no redesign needed

This is the most important compatibility finding of this task, and the
reason EXP-002-T02-T04 can build directly on EXP-003's existing
pagination rather than replacing it: every filter in section 3 is an
**additional `$and`-ed predicate in the Mongo query**, not a change to
the sort key. `buildCursorFilter()`'s keyset predicate
(`expenseDate < cursor.date OR (expenseDate == cursor.date AND _id <
cursor.id)`) stays correct regardless of which other predicates are also
present in the same query, because it only constrains position within
the `(expenseDate DESC, _id DESC)` ordering -- it does not care what
else narrowed the candidate set. Confirmed by re-reading
`buildCursorFilter()`/`paginateResults()` in `utils/pagination.js`
directly rather than assuming.

**One real caveat, worth stating explicitly rather than discovering it
during T04's implementation:** a cursor's validity is scoped to "the
same set of filters used to produce the page that cursor came from." A
client that changes `category` (or any other filter) between page 1 and
page 2 of the same paging sequence, while reusing page 1's cursor, will
get a valid-but-nonsensical result (the cursor still anchors correctly on
`(expenseDate, _id)`, but the newly-added/changed filter now applies
retroactively to a position it was never used to establish). This is not
a new problem EXP-002 introduces -- `getByCustom` already has the
identical property today for `startDate`/`endDate` themselves (nothing
stops a client from changing the date range mid-pagination) -- so no new
mechanism is needed to solve it now; T02 should simply carry this same,
already-accepted contract forward for the new filters rather than solve
a problem the existing endpoint doesn't solve for its current parameters
either.

## 6. Index implications (flagged for T04, not solved here)

Per DAT-002-T01's index inventory, `expenses` has exactly two indexes
today: `{userId, id}` (unique) and `{userId, expenseDate}`. Every filter
combination in section 4 still includes the required date range, so
every query will use `{userId, expenseDate}` as its base access path;
the question T04 needs to answer is which additional predicates benefit
from becoming part of a compound index versus staying an in-memory
filter over the date-range-narrowed result set:

- `isRecurring` and `category` are cheap, exact-match, low-cardinality
  predicates -- straightforward candidates for
  `{userId, expenseCategory, expenseDate}` / `{userId, isRecurring,
  expenseDate}` compound indexes if query patterns justify them.
- `nameContains` (substring) and the `minAmount`/`maxAmount` range are
  harder: Mongo can use at most one range condition efficiently per
  compound index scan, and `expenseDate` is already that range condition
  in every query here -- stacking an amount range AND a date range in
  the same compound index does not get full index support for both
  simultaneously. This is a real query-planning tradeoff for T04 to
  measure (e.g. with `explain()`), not a decision this task makes.

## 7. Verification

Every current-state claim in section 1 came from reading
`getbycustom.js`, `fetchExpenses.js`, `getbycategory.js`, and
`ExpensesPage.js`'s filter/period state directly, not from the feature
doc's audit note alone (though it corroborates). Every "existing
abstraction" claim in section 2 came from reading the named file in
full: `utils/pagination.js`, `utils/categoryNormalization.js`,
`utils/merchantNormalization.js`, and cross-referencing
`docs/data/DAT-002-T01-schema-and-index-inventory.md`'s already-verified
field/index tables for `expenseSchema` rather than re-deriving them. The
`MAX_PERIOD_SPAN_DAYS` precedent (section 1) came from reading
`backend/sia/financialQueryService.js` directly. No code was changed as
part of this task.
