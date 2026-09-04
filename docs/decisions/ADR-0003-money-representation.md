# ADR-0003: Represent money as integer minor units (DAT-001-T01)

## Decision

All monetary amounts (`expenseAmount`, `incomeAmount`, `budget`, `spent`,
and any future money field) will eventually be stored and computed as
**integer minor units** -- for the current single-currency INR scope,
that means integer paise (1 rupee = 100 paise), not floating-point
rupees. This ADR records the decision only; it does not migrate any
schema or code -- that is DAT-001-T02 through T07's scope, in the
already-sequenced order (inventory, central helpers, shadow fields,
dual-read verification, cutover, cleanup after OPS-002 backup exists).

### Scope confirmation

The codebase is single-currency today: no `currency` field exists on any
schema (`backend/config/Schemas.js`, `backend/models/`), and every
money-formatting function found (`SpendingForecast.js`,
`AnomalyInsights.js`, and others) hardcodes `₹` with the `en-IN` locale.
INR's ISO 4217 minor unit is 2 decimal digits (paise), which is what
"integer minor units" resolves to concretely for this codebase. If a
second currency is ever introduced, this decision needs revisiting --
integer minor units alone are not currency-safe once the exponent varies
per currency (INR/USD use 2 decimals, JPY uses 0, some currencies use 3).

### Naming and rounding convention (binding on T02-T07)

- New integer fields use an explicit `Minor` suffix during the migration
  so a field's unit is never ambiguous mid-rollout: `expenseAmountMinor`,
  `incomeAmountMinor`, `budgetMinor`, `spentMinor`. The legacy `Number`
  fields keep their existing names until DAT-001-T07 removes them.
- Conversion rupees -> paise rounds **half away from zero** (i.e.
  `Math.round` semantics: 49.995 -> 5000 paise, -49.995 -> -5000 paise),
  applied exactly once at every input boundary (API request body, OCR/ML
  parsed amount, manual entry) -- never re-derived from an
  already-rounded value. This is DAT-001-T03's helper module to build and
  the single place this rule is implemented.
- All arithmetic (sums, budget-vs-spent comparisons, forecasts, category
  aggregation) happens on the integer minor-unit value. Conversion back
  to a decimal rupee amount happens only at the display/formatting
  boundary (frontend, PDF/CSV export, API response shaping), never
  mid-calculation.

## Context

`backend/config/Schemas.js` stores `expenseAmount`, `incomeAmount`,
`budget` and `spent` as plain Mongoose `Number` (IEEE-754 double)
today, with no minor-unit field to fall back on. That representation can
silently introduce rounding differences in totals, budget-vs-spent
comparisons, forecasts and exports (DAT-001's problem statement) --
classic floating-point-money bugs (`0.1 + 0.2 !== 0.3`) are reachable
anywhere amounts are summed or compared across the analytics, budget and
report pipelines.

Integer minor units are the standard fix used by most payment/ledger
systems for exactly this reason: integer arithmetic has no representation
error, so a sum of N integers is exact regardless of N, unlike a sum of N
floating-point rupee values.

## Consequences

- DAT-001-T02 (inventory every amount field and arithmetic path) now has
  a concrete target representation to inventory against, and a naming
  convention (`*Minor`) to use consistently across the inventory.
- DAT-001-T03 (central money parsing/formatting helpers) must implement
  the rounding rule above as the single source of truth for
  rupees<->paise conversion -- no call site should round independently.
- DAT-001-T04 (shadow minor-unit fields) adds the `*Minor` fields
  alongside the existing `Number` fields without removing anything yet;
  existing reads/writes keep working during the migration.
- DAT-001-T07 (remove legacy fields) is correctly sequenced after
  reconciliation AND after a backup exists (OPS-002) -- do not remove the
  legacy floating-point fields until both are true.
- This ADR does not change any code, schema, or runtime behavior by
  itself. It only fixes the target representation and rounding rule that
  every later DAT-001 task builds on.
