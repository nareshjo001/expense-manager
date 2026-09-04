# DAT-001-T06: Switch APIs and frontend formatting -- cutover runbook

DAT-001-T06 has two halves with very different risk profiles. This
document covers what's done, what's deliberately not done, and the exact
steps left for whoever has a real staging/production environment to run
them in.

## What's done (code-complete, low risk)

**Dual-write.** `backend/utils/moneyMinorSync.js` attaches Mongoose
`pre('save')` and `pre('findOneAndUpdate'|'updateOne'|'updateMany')`
hooks to `expenseSchema`, `budgetSchema`, `IncomeSchema`, and
`RecurringExpenseSchema` (wired in `config/Schemas.js` and
`models/RecurringExpense.js`). Whenever a legacy money field
(`expenseAmount`, `incomeAmount`, `budget`, `spent`) is written, the
matching `*Minor` field is recomputed from it via
`utils/money.js`'s `toMinorUnits()` -- the same rounding rule
(ADR-0003) the `20260903-backfill-money-minor-fields` migration (T04)
used for existing documents. This does not change anything any
controller, aggregation, or API response reads or returns -- it only
keeps the shadow field from falling behind on new writes.

Gated behind `MONEY_MINOR_DUAL_WRITE_ENABLED=true` (unset/false by
default). Flip it on in staging first and watch it for a real rollout
window before production -- see "Turning dual-write on" below.

**Dual-read verification.** `backend/scripts/verifyMoneyMinorFields.js`
(T05) recomputes every document's expected `*Minor` value from its
legacy field and reports any mismatch or any document still missing its
shadow field. Read-only, safe to run repeatedly against a live database.

## What's NOT done, and why

Switching the actual read/arithmetic paths -- every `$sum` aggregation,
every `reduce()`-based total, every budget-vs-spent comparison, and the
frontend's `₹`/`en-IN` formatting -- to compute from `*Minor` instead of
the legacy float field. Per DAT-001-T02's inventory, that's at minimum:
`Services/BudgetServices/budget.service.js`'s `recalculateBudget()`,
`sia/financialQueryService.js`'s aggregation pipelines,
`Services/ChartServices/chart.service.js`, and roughly a dozen
`analytics/analyzers/*.js` files, plus every frontend component that
formats an amount for display.

This is not being done here because:

1. **ADR-0003's own sequencing requires it to come after T05's
   verification has actually run clean, across a real rollout window,
   against real production data.** This session has never had a real
   database to write real traffic against -- `verifyMoneyMinorFields.js`
   has only ever been tested against small in-memory fixtures
   (`backend/tests/verifyMoneyMinorFields.test.js`). A clean fixture test
   is not evidence a real production dataset's `*Minor` fields are
   trustworthy.
2. **The blast radius of getting a cutover wrong is a wrong number shown
   to every user** -- an incorrect budget-remaining figure, a wrong
   category total, a wrong forecast. That is a materially different risk
   class from T03's helper (additive, unit-tested in isolation) or T04's
   backfill (additive, reversible by just not reading the new field) or
   this dual-write (additive, silently ignorable if wrong).
3. Several of the read paths this would touch
   (`budget.service.js`'s `recalculateBudget`, `addexpense.js`'s
   idempotency/reservation logic it feeds into) are concurrency-sensitive
   code this session cannot safely modify without integration tests
   running against a live database to catch a regression.

## Turning dual-write on

1. Set `MONEY_MINOR_DUAL_WRITE_ENABLED=true` in staging.
2. Let real traffic (or a realistic synthetic load) write for a while.
3. Run `node backend/scripts/verifyMoneyMinorFields.js` against that
   staging database. Expect `summary.clean: true` -- if not, the
   mismatch samples in the output name the exact documents to
   investigate before going further.
4. Repeat step 3 periodically (not just once) across the rollout window
   -- new code paths or edge cases can surface later.
5. Once staging has stayed clean for a real rollout window, enable the
   flag in production the same way, and keep running the verify script
   there on a schedule (a cron job, or a CI scheduled workflow) for as
   long as both representations exist.

## The actual read-side cutover (once step 5 above is clean)

Not attempted here -- for whoever has staging/production access:

1. Pick one read path at a time, starting with the simplest
   (`Services/ChartServices/chart.service.js`'s budget-remaining
   subtraction is a good first candidate: one comparison, easy to
   verify against the dashboard by eye).
2. Switch it to read `*Minor`, compute in integer paise
   (`utils/money.js`'s `sumMinor()` for any summation), and convert to
   rupees only at the final formatting boundary
   (`utils/money.js`'s `formatMoneyMinor()`) -- never mid-calculation,
   per ADR-0003.
3. Compare its output against the pre-cutover (legacy-field) output on
   real data before merging -- a temporary side-by-side log line
   comparing both, removed once confidence is established, is a
   reasonable way to do this without a full A/B framework.
4. Repeat per call site. `sia/financialQueryService.js`'s aggregation
   pipelines and the dozen `analytics/analyzers/*.js` reduce-based sums
   are the largest remaining group -- migrate them in batches, not all
   at once, so a bad cutover is easy to isolate and revert.
5. Frontend formatting (the `₹`/`en-IN` hardcoded formatters ADR-0003
   found in `SpendingForecast.js`, `AnomalyInsights.js`, etc.) switches
   last, once every API response it reads from is already minor-unit
   correct.

## DAT-001-T07 (remove legacy fields) stays blocked on this

Per ADR-0003, the legacy float fields cannot be removed until BOTH: (a)
reconciliation evidence from the cutover above shows the two
representations agreed the whole way through, and (b) OPS-002 has real
encrypted backups in place (currently blocked -- see
`docs/decisions/ADR-0005-backup-rpo-rto.md`, OPS-002-T02, still
`PROPOSED` pending owner approval). Do not remove `expenseAmount`,
`incomeAmount`, `budget`, or `spent` before both are true.
