# ADR-0008: Financial derived-data boundary, classification and invalidation contracts (ARC-001-T01..T04)

## Status

Accepted. Documents an architecture that was already built incrementally
by DAT-001, DAT-002, OPS-002 and the "Phase C" expense-mutation
reliability work; this ADR is the first place it is written down as one
coherent decision record, which is precisely the gap ARC-001's own
2026-09-08 audit flagged ("No derived-field inventory, classification,
boundary decision or invalidation contract exists under docs/").

## Context

ARC-001 was scoped on 2026-09-08 against evidence that has since moved:
`models/FinancialReport.js` (now `models/Report.js`), `utils/
expenseCache.js`, a since-renamed `Services/derivedDataSync.service.js`
(no longer exists under that name), and `frontend/src/insights-engine`
were named as "duplicate representations" that "each maintain derived
interpretations" of the authoritative expense/income data, creating
"invalidation, recovery, stale-data and maintenance paths."

T01-T04 (inventory, classify, choose the boundary, define the invalidation
contract) were re-run against the CURRENT codebase rather than assumed
from the stale audit. The finding is materially different from the
original premise: the staleness-risk problem ARC-001 was written to solve
has already been solved, as a byproduct of unrelated feature work done
after this feature was scoped. `ADR-0002-authoritative-vs-disposable-
stores.md` (OPS-002-T01) already classified `Report` and every current
Redis key as disposable/derived for backup purposes -- this ADR extends
that classification with the piece OPS-002 did not need: exactly how each
derived value is invalidated and rebuilt, and where the read-model
boundary actually sits.

## T01 -- Inventory of every derived financial value

Confirmed by reading the actual current source, not the 2026-09-08
evidence paths (two of which -- `FinancialReport.js`, `derivedDataSync.
service.js` -- no longer exist under those names):

| Derived value | Where it lives | Where it is computed | Where it is read |
|---|---|---|---|
| Assembled financial report | `models/Report.js` (Mongo, per user, `strict:false`, `version`-stamped) | `analytics/reportGenerator.js` via `Services/reportService.js` | `Controllers/*` that serve the report screen |
| Report cache | `cache/reportCache.js` (Redis, 1h TTL, revision-CAS'd via a Lua script) | Same `reportService.js` write path | Same report-serving controllers, as a fast path before Mongo |
| Budget `spent` | `BudgetModel.spent` field (Mongo) | `Services/BudgetServices/budget.service.js`'s `recalculateBudget` (aggregates `ExpenseModel` for the month) | `Controllers/BudgetControllers/*`, `Services/ChartServices/chart.service.js`, `sia/*` (read-only everywhere -- confirmed, see T05 below) |
| Generic short-TTL cache | `utils/expenseCache.js` (Redis, 300s TTL) | Whichever controller populates it (e.g. `getbycustom.js`) | Same controllers, as a fast path |
| Request-scoped totals (not persisted) | Nowhere -- computed fresh per request | `analytics/analyzers/*`, `Controllers/IncomeControllers/insightsCard.js` + `insightsHeader.js`, `Services/ChartServices/chart.service.js`, `sia/financialQueryService.js` | Whichever request triggered them |
| Weekly anomaly signal | Nowhere -- computed fresh client-side | `frontend/src/insights-engine/rules/overallSpend.js` (+ `anomalyDetection.js`, `buildWeeklyBaseline.js`) | The frontend insights UI only |

## T02 -- Classification

Using ARC-001-T02's own three buckets (recomputable / cached / required),
and ADR-0002's existing authoritative/disposable split as the starting
point:

- **Required, persisted, actively invalidated:** `BudgetModel.spent`.
  Read on every budget view; recomputing it on every read would mean an
  `ExpenseModel` aggregation per view instead of per mutation. Correctly
  persisted, not merely cached.
- **Cached, disposable, self-healing:** `Report` (Mongo) and its Redis
  mirror (`reportCache.js`). Both already carry ADR-0002's disposable
  classification. Losing either costs one regeneration, never data.
- **Cached, disposable, generic:** `utils/expenseCache.js`. Same tier,
  narrower scope (arbitrary controller-defined keys, not the report
  specifically).
- **Recomputable, never persisted, no staleness risk by construction:**
  every analyzer, the two Income insight-card controllers, chart service,
  and SIA's `financialQueryService.js`. These read `ExpenseModel`/
  `BudgetModel` directly on each request and derive a value in memory;
  there is nothing to invalidate because nothing is stored between
  requests.
- **Recomputable, client-side, a DIFFERENT signal from anything server-
  side:** `frontend/src/insights-engine`'s weekly anomaly detector. See
  the explicit exclusion below -- this is not the same bucket as "redundant
  duplicate," even though it is also "recomputable, never persisted."

## T03 -- The single report/read-model boundary

**Decision: `models/Report.js`, assembled exclusively by `analytics/
reportGenerator.js` and served exclusively through `Services/
reportService.js`, is the one authoritative derived read-model boundary
for "the assembled financial report" use case.** `cache/reportCache.js`
is not a second boundary -- it is a read-through cache IN FRONT of that
same boundary, sharing its revision numbering (see T04), not an
independent representation that could drift from it.

`BudgetModel.spent` is a second, narrower read-model boundary for a
different use case (the current month's budget-vs-spend figure), owned
exclusively by `budget.service.js`'s `recalculateBudget`. It is
deliberately NOT folded into the Report boundary: a budget update needs
to be reflected the moment an expense is saved (via `synchronizeAfterMutation`,
see T04), while the assembled report is read far less often and at a
different granularity. Two boundaries here reflect two genuinely
different read patterns, not accidental duplication -- collapsing them
would either make every expense-save pay for a full report regeneration,
or make every report read block on a live aggregation.

No third persisted boundary exists or is proposed. Every other consumer
identified in T01 reads directly from the authoritative `ExpenseModel`/
`BudgetModel` collections at request time.

## T04 -- Invalidation and rebuild contracts

Both persisted derived boundaries already have a concurrency-safe,
tested invalidation contract; this section documents it as the record
ARC-001 asked for, and changes nothing in the code:

**Report boundary** (`models/Report.js` + `cache/reportCache.js`):
1. Every expense/budget mutation calls `Services/syncRecoveryService.js`'s
   `synchronizeAfterMutation`, which computes a monotonic `fenceRevision`
   and calls `reportService.js`'s regeneration path with it.
2. `persistAndCache()` writes the new report to Mongo with a
   `findOneAndUpdate` filter that only matches when the document's
   `syncRevision` is absent or `<= fenceRevision` -- an out-of-order write
   (a slow request finishing after a newer one) is a documented no-op
   (`{skipped: true, reason: 'superseded'}`), never a stale overwrite.
3. On a successful Mongo write, the SAME revision is written to
   `reportCache.js` via `CAS_SET_SCRIPT`, a Redis Lua script that performs
   the identical `incomingRevision >= storedRevision` check atomically
   inside Redis, closing the race a plain `GET`-then-`SET` would have.
4. A stale/missing report is additionally self-healing on read:
   `reportContractVersion.js`'s `isCurrentReport()` triggers regeneration
   on a version mismatch, independent of the mutation-triggered path.

**Budget boundary** (`BudgetModel.spent`):
1. Same `synchronizeAfterMutation` entry point calls `recalculateBudget`
   with the same `fenceRevision`.
2. `recalculateBudget` re-aggregates `ExpenseModel` for the month and
   writes `spent` via a `findOneAndUpdate` fenced the same way (`syncRevision
   {$exists:false} OR {$lte: fenceRevision}`), with the same documented
   `{skipped, reason: 'superseded'}` outcome on a lost race.
3. `budget.spent` has exactly one writer in the entire codebase
   (`recalculateBudget` -- verified by grepping every `.spent` write
   site); every other reference (`chart.service.js`, `sia/*`, export
   generation, budget insights) is read-only.

**Generic caches** (`utils/expenseCache.js`): TTL-bound (300s) plus
explicit `clearUserExpenseCache()` calls wired into the same
`synchronizeAfterMutation` path. No revision fencing needed here because
a stale generic cache entry is simply overwritten by the next read, not
read-modify-written.

## Explicit scope exclusion: the frontend insights-engine is not a duplicate

`frontend/src/insights-engine/rules/overallSpend.js` computes a **7-day
rolling total-spend comparison with a volatility-adaptive anomaly
threshold** (`buildWeeklyBaseline` + `detectExpenseAnomaly`). No backend
analyzer computes this: `analytics/analyzers/*` and `reportGenerator.js`
operate at monthly granularity (`summary.totalSpent`, `dailyAverage`,
`comparePastMonth`, `healthScore`). This is a genuinely different signal,
not a stale re-derivation of one the backend already produces. The
2026-09-08 audit's characterization of this directory as a "redundant...
representation" is not supported by what the code actually does.
Retiring or "unifying" it under the Report boundary would be a **feature
regression** (losing weekly anomaly detection), not a simplification.
This directory is explicitly out of scope for T05/T06 migration below,
and this paragraph is the record of that decision so a future pass does
not mistake it for leftover duplication.

SIA's `sia/financialQueryService.js` is excluded for the same reason: it
answers ad-hoc natural-language questions about arbitrary date ranges the
user names in conversation, a query shape the Report boundary (fixed
period, pre-assembled) cannot serve. It reads `ExpenseModel`/`BudgetModel`
directly by design, same as every other request-scoped consumer in T02's
"recomputable" bucket.

## T05/T06 -- Migration and retirement, as actually found

Contrary to ARC-001's original scope (which assumed active migration work
across "the persisted report, `expenseCache.js`, stored `budget.spent`,
and the frontend insights-engine"), direct evidence shows nothing
persisted needs migrating and nothing computed needs retiring:

- Both persisted boundaries (Report, budget.spent) already have exactly
  one writer each, already fenced, already wired through the shared
  `synchronizeAfterMutation` entry point. There is no legacy/unfenced
  write path to migrate away from.
- The frontend insights-engine and SIA's query service are not redundant
  (see above) -- there is nothing to retire.

The one real, low-risk opportunity that DOES exist, and is explicitly
named in ARC-001's own acceptance criteria ("duplicate logic is removed
rather than copied"), is request-scoped **code** duplication: `Controllers/
IncomeControllers/insightsCard.js`, `insightsHeader.js`, and `Services/
ChartServices/chart.service.js` each independently re-implement "sum an
array of `{expenseAmount}`/`{incomeAmount}` records." This is not a
staleness risk (nothing is persisted), just maintenance surface. See the
follow-up implementation note below for the small, isolated cleanup done
under this same ADR's authority.

## Consequences

- Future features adding a new persisted derived value must classify it
  here (extend T01/T02's tables) or in a follow-up ADR, the same
  obligation ADR-0002 already states for backup-tier classification.
- The frontend insights-engine and SIA's ad-hoc query path are formally
  confirmed as intentionally separate; a future refactor should not
  "simplify" them into the Report boundary without first re-litigating
  this decision.
- No schema, migration, or runtime behavior changes as a result of T01-T04
  themselves. The small T05/T06 cleanup (shared aggregation helper) is
  additive and covered by its own tests.
- ARC-001-T07 (measure query latency/consistency in staging before
  removing recovery paths) is not applicable to this outcome: nothing
  above proposes removing a recovery path, and this codebase's staging
  environment remains unavailable in this sandbox, the same evidence gap
  already blocking DAT-003-T07/OBS-001-T07.
