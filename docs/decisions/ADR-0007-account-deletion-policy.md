# ADR-0007: Account deletion policy -- immediate vs. delayed (PRV-001-T02)

**Status: PROPOSED.** This is a product-policy decision made in the course
of implementing PRV-001, in the same spirit as ADR-0005's provisional
RPO/RTO numbers: a concrete, reasoned default that unblocks T03-T07's
implementation, explicitly revisitable once the compliance-jurisdiction
question (still UNKNOWN per ADR-0005) is resolved or Naresh wants a
different number. Built directly on
[PRV-001-T01](../privacy/PRV-001-T01-user-data-and-external-services-inventory.md)'s
verified inventory rather than re-deriving it.

## Decision

**A 14-day cancellable grace period**, with a three-tier data-handling
split by WHEN each category of user-linked data is actually removed:

### Tier A -- immediate, at request time (before/independent of the grace period)

Revoked or cleared the moment a re-authenticated deletion request (T03) is
accepted, regardless of whether the 14-day window later gets cancelled:

- **All active sessions** (`refreshsessions`) -- reuse
  `Services/AuthServices/session.service.js`'s existing
  `revokeAllSessions(userId)` verbatim (already used by the account's
  "logout everywhere" path per `Controllers/AuthControllers/session.js`).
  Forces every device to re-authenticate; a legitimate owner who wants to
  cancel simply logs back in (see "Cancellation" below) and a fresh
  session is issued normally -- no new auth mechanism needed.
- **Push device tokens** (`devicetokens`) -- deleted outright, not just
  revoked. Confirmed by PRV-001-T01: Firebase sends are stateless
  per-call, so there is no external FCM-side action to take, and a
  deleted token means `push.service.js`'s `DeviceToken.find({ userId })`
  simply returns nothing from that point on.
- **Recurring-expense job eligibility** -- `cron/recurringJob.js` must
  skip any user with a pending deletion from this point forward. This
  requires a new "pending deletion" signal T03/T04 will add to `users`
  (this ADR does not design that field's exact shape -- that is
  implementation, not policy).
- **Redis cache** -- best-effort immediate clear via the two reusable
  functions PRV-001-T01 already found: `clearUserExpenseCache(userId)`
  and `reportCache.invalidate(userId)`. Harmless if it races with a
  concurrent read (TTL-bound, self-heals either way), so "immediate" here
  means "as soon as convenient," not a hard guarantee.

Rationale for treating these as immediate rather than grace-gated: none
of them are irreversible data loss (a session/token/cache entry is
trivially regenerated), and leaving them alive during a "pending
deletion" account is a real, avoidable security/product liability (stale
sessions staying valid, push notifications continuing to arrive for an
account the owner asked to close, a recurring expense still materializing
new transactions during the grace window).

### Tier B -- soft-deleted at request time, hard-deleted after the grace period

Every other user-linked collection PRV-001-T01 identified -- the
remaining 12 of the 14 user-linked collections (all of section 1's table
except `refreshsessions`/`devicetokens`, already covered in Tier A):
`users` itself, `expenses`, `incomes`, `budgets`, `merchantcategoryrules`,
`mlfeedbacks`, `recurringexpenses`, `financialreports`, `pendingsyncs`,
`notifications`, `siasessions`, `siamessages`, `siarequests`.

- At request time: `users` gets a scheduled-deletion marker (exact field
  design deferred to T03/T04); every other collection in this tier is
  left untouched on disk. Nothing is deleted yet.
- For the 14 days that follow, the account can still be logged into (its
  password is unchanged and its data still exists), but every
  state-changing action except "view my data" and "cancel deletion" is
  blocked -- this is an authorization-layer decision, not a data-layer
  one, and belongs to T03/T04's implementation, not this ADR.
- If the 14 days elapse with no cancellation, every document in every
  collection in this tier, scoped to that `userId`, is permanently
  deleted, `users` itself last (so a crash mid-deletion never leaves an
  account that looks "gone" from the login screen but still has orphaned
  data, or vice versa).

**`mlfeedbacks` is deliberately included in the hard-delete set, not
retained/anonymized.** ADR-0002 classifies it "authoritative" (real
signal that cannot be regenerated) from a BACKUP-recoverability
standpoint, which is a different question from whether a deleting user's
own feedback should survive their deletion request. Given the
compliance-jurisdiction unknown (ADR-0005) and no stated business reason
to retain it, the safer default is to honor "delete everything" as
literally as the rest of this tier, not carve out a quiet exception a
user asking for full deletion would not expect. **Also resolves
PRV-001-T01's gap 4.1** (`MlFeedbackSchema.userId` is not `required`): T04's
orchestration must treat a null/missing `userId` on an `mlfeedbacks`
document as un-owned and therefore untouched by any single user's
deletion (there is nothing to scope the deletion query to) -- this ADR
does not attempt to retroactively assign orphaned documents to a user,
since that would be a guess, not a fact recovered from data.

### Tier C -- unaffected

Nothing today. (Kept as an explicit heading rather than omitted, so a
future addition to this policy has an obvious place to note anything that
should be excluded from both tiers -- e.g. if a future aggregate/anonymized
analytics store is ever built.)

## Cancellation

A logged-in session during the grace period (Tier A revoked the old ones,
but a fresh login is always allowed -- the account is not locked, only
restricted) can cancel the pending deletion, which clears the `users`
marker and returns the account to normal. No separate out-of-band
cancellation channel (e.g. an emailed link) is built for this -- reusing
ordinary login is simpler and sufficient, and PRV-001-T01 already flagged
that this app's transactional-email integration (Brevo) has no documented
delivery guarantee, making it a worse foundation for a time-sensitive
cancellation flow than the login path this app already has full control
over.

## The already-documented backup-persistence limitation still applies

PRV-001-T01 (citing ADR-0005) already established that a deleted user's
data in the 5 overlapping authoritative collections persists in encrypted
backups for up to ~35 days after the HARD delete (not the grace-period
start) regardless of this policy. This ADR does not change that -- T03's
user-facing deletion confirmation copy should state it plainly (e.g.
"fully removed from active systems immediately; may remain in encrypted
backups for up to 35 days"), consistent with this codebase's existing
practice of documenting a limitation rather than either hiding it or
attempting to solve a problem out of this feature's scope (backup
retention belongs to OPS-002/ADR-0005, not PRV-001).

## Why 14 days, not a different number

No stated user-tolerance study or contractual SLA exists for this
product (the same position ADR-0005 was in for its own numbers). 14 days
is chosen as a middle ground: long enough that an accidental or
emotional in-the-moment deletion request has a real, practical chance to
be reversed (a common pattern -- GitHub, Google and most consumer apps
use a grace window in this general range, none instant), short enough
that it doesn't undercut the feature's whole purpose ("provide...
deliberate deletion" -- data that famously never actually gets deleted is
a known trust failure mode this feature exists to avoid). **Provisional,
same as ADR-0005's numbers** -- if the compliance-jurisdiction unknown
resolves to a regime with a mandated maximum response time for an
erasure request, this ADR needs a follow-up revision to match it, not a
silent override.

## What this ADR is *not*

- Not a database/API design. T03 (request/confirmation flow), T04
  (orchestration engine), T05 (Tier A implementation) and T06 (Tier B
  propagation) still make every implementation decision this ADR
  deliberately left open (the exact `users` marker field, the
  authorization-layer block during the grace period, the orchestration's
  resumability contract).
- Not a compliance sign-off, for the same reason ADR-0005 was not one.
- Not an owner-approval gate the way ADR-0005 required for its
  infrastructure-cost-driving numbers -- this is a product-policy default
  made under this session's existing authorization to carry PRV-001
  forward, recorded here (not silently assumed) precisely so it is easy
  for Naresh to review, accept, or override this number later without
  having to reconstruct the reasoning from scratch.

## Verification

Every existing-abstraction claim (`revokeAllSessions`,
`clearUserExpenseCache`/`invalidate`, the 14-collection user-linked set,
the ADR-0002/ADR-0005 backup-retention figures) was re-confirmed against
its actual source file or the already-completed PRV-001-T01 inventory
before being cited here, not assumed from memory of this session's
earlier work: `Services/AuthServices/session.service.js` and
`Controllers/AuthControllers/session.js` were read directly to confirm
`revokeAllSessions(userId)` already exists and is already wired to a real
route; `cron/recurringJob.js`'s existence was confirmed via `ls
backend/cron/` (its actual per-user skip logic is left to T04/T05 to
implement, not designed here). No code was changed as part of this task.
