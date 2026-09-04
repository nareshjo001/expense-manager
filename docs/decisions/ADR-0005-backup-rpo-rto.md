# ADR-0005: Provisional RPO/RTO for authoritative stores (OPS-002-T02)

**Status: PROPOSED -- pending owner approval.** This ADR sets *working*
targets so OPS-002-T03 onward has something concrete to build against. It
is deliberately not final; see "Approval" below for why.

## Decision (provisional)

- **RPO (Recovery Point Objective): <= 24 hours** for the 7 authoritative
  MongoDB collections classified in
  [ADR-0002](ADR-0002-authoritative-vs-disposable-stores.md) (`users`,
  `expenses`, `incomes`, `budget`, `RecurringExpense`,
  `MerchantCategoryRule`, `mlFeedback`). A daily backup cadence satisfies
  this. Tighten to point-in-time/continuous backup (RPO measured in
  minutes, not hours) once OPS-002-T03 picks a specific mechanism, if that
  mechanism supports it at acceptable cost.
- **RTO (Recovery Time Objective): <= 4 hours** from an operator declaring
  a recovery event to the restored authoritative data being queryable and
  application-level-reconciled. This is a target to validate, not an
  assumed fact -- OPS-002-T06 (run and record a restoration drill) is
  where it gets measured against the real restore procedure built in
  T03-T05.
- **Retention: provisional 35 rolling daily backups (~5 weeks)** for the 7
  authoritative collections, pending the compliance question below.
- **Redis and every other disposable/derived store** (per ADR-0002): no
  RPO/RTO target. By definition, losing them costs at most one cache
  regeneration or a forced re-login -- they are explicitly out of scope
  for the backup guarantee OPS-002 is building.

## Rationale for these specific numbers

- **24h RPO / daily cadence** is the lowest-effort mechanism (a single
  scheduled `mongodump` or a managed daily snapshot) that still bounds
  worst-case data loss to "at most yesterday's data." That is
  proportionate to a personal expense-tracking app with no documented
  SLA, no real-time trading, and no multi-party financial settlement --
  unlike a bank or payment processor, where a near-zero RPO is mandatory
  regardless of cost. ADR-0002 already narrows backup scope to the 7
  collections that cannot be regenerated, so this is deliberately not
  "back up everything, continuously."
- **4h RTO** reflects a single-operator, no-automatic-failover, small-team
  assumption. OPS-002's own spec (section 9) explicitly marks "primary
  client device, traffic, SLO... UNKNOWN," so there is no measured user
  expectation to anchor this number to yet -- it is a starting point for
  T06's drill to confirm or correct, not an assertion of fact.

## What this ADR is *not*

- **Not a compliance sign-off.** OPS-002's spec (section 9) explicitly
  marks "compliance jurisdiction" as **UNKNOWN**. If this product
  operates under GDPR, India's DPDP Act, or a similar regime, real
  data-residency, retention-ceiling, or right-to-erasure requirements
  could force different numbers than the ones above -- particularly the
  retention window, which today is a floor (keep at least 5 weeks) with
  no corresponding ceiling (delete after N days) analysis.
- **Not based on a measured user-tolerance study or a contractual SLA.**
  Neither exists yet for this product. These numbers exist so
  OPS-002-T03-T07 have a concrete target to build and drill against,
  not because they were derived from a requirement someone stated.

## Approval

This ADR is **PROPOSED**, not final. Actual owner sign-off is needed
before OPS-002-T03 (encrypted Mongo backups) locks in infrastructure
against these numbers, because:

1. The RPO/RTO values directly gate how much backup infrastructure
   cost and complexity T03-T07 take on -- a tighter RPO than 24h likely
   means paying for a managed continuous-backup product rather than a
   cron job.
2. The compliance-jurisdiction unknown could specifically invalidate the
   retention number above (both the 35-day floor and the missing
   ceiling).

Until an owner records approval -- by changing this ADR's Status line to
ACCEPTED, or via an explicit sign-off recorded in the tracker/a PR review
-- OPS-002-T03 should treat the numbers above as a working default to
build against, not a locked requirement it cannot revisit.

## Consequences

- OPS-002-T03 can proceed today using "daily encrypted backup, 35-day
  rolling retention, scoped to the 7 ADR-0002 authoritative collections"
  as its working target, without waiting idle for sign-off.
- OPS-002-T06's restoration drill is the actual validation of whether 4h
  RTO is realistic for this codebase's real restore procedure. If the
  drill measures longer, this ADR should be revised to match reality
  rather than having the drill result quietly ignored.
- If the compliance-jurisdiction unknown is later resolved and conflicts
  with the retention number, this ADR needs a follow-up revision before
  OPS-002 is considered done -- it does not silently override a real
  compliance requirement.
