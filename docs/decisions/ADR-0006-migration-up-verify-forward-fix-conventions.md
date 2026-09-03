# ADR-0006: up/verify context shape and forward-fix policy (DAT-003-T03)

## Decision

Three things this ADR fixes, extending
[ADR-0004](ADR-0004-migration-runner-choice.md)'s file-shape convention
and building directly on DAT-003-T02's ledger/lock:

### 1. The `context` object `up(context)` and `verify(context)` receive

```js
{
  mongoose,  // the app's already-connected mongoose instance (config/db.js's
             // connectDB() has already run before any migration executes --
             // a migration never opens its own connection)
  logger,    // backend/utils/logger.js's logEvent, pre-bound with
             // scope: "migrations" and the running migration's id, so every
             // migration's log lines are already attributable without each
             // migration file repeating that boilerplate
  dryRun,    // boolean. Wired for real by DAT-003-T04's execution driver;
             // fixed here so migration authors can write against the final
             // shape today instead of being told to guess
}
```

`up()` must treat `dryRun: true` as "compute and log what would change,
perform zero writes." A migration that ignores `dryRun` defeats the one
mechanism an operator has to preview a migration before it touches
production data.

### 2. What `up()` and `verify()` must each guarantee

**`up(context)`:**

- Applies exactly one logical schema/data change. Two unrelated changes
  are two migration files, not one -- this keeps forward-fixes (below)
  targeted instead of re-touching unrelated data.
- Is defensively idempotent-safe, even though DAT-003-T02's ledger and
  lock are the primary guard against double-execution. The lock only
  guarantees *one runner process* applies a given migration; it does not
  protect against a future operator manually re-invoking a migration
  file's `up()` outside the runner, or a ledger record being lost. Prefer
  Mongo operations that tolerate re-application on their own
  (`updateMany` with a filter that excludes already-migrated documents,
  `createIndex` which is a no-op if the index already exists,
  `$setOnInsert`) over operations that assume a pristine starting state
  (a bare unconditional `insertMany`, an unconditional `$push`).
- Throws on any failure rather than swallowing it. A migration that
  catches its own error and returns normally is the one failure mode the
  ledger cannot detect -- `recordApplied()` (DAT-003-T02) is only ever
  called after `up()` resolves without throwing, so a caught-and-hidden
  error gets silently recorded as a successful migration.

**`verify(context)` (optional, but strongly recommended for any migration
that isn't trivially self-evident):**

- Read-only. `verify()` never writes -- if it needs to write to check
  something, that write belongs in `up()` instead.
- Checks the *outcome*, not that `up()` ran without throwing (the runner
  already knows that). E.g. an index-creation migration's `verify()`
  should query `collection.indexes()` and assert the expected index is
  actually present, not just trust that `createIndex()` resolved.
- Throws (does not return `false` or log-and-continue) when the
  post-condition does not hold. A thrown `verify()` error is what
  distinguishes "ran, but did not produce the expected result" from
  quiet success, and is the trigger for the forward-fix policy below.

### 3. Forward-fix only -- no `down()`

This runner will never gain a `down()`/rollback export. If a migration
turns out to be wrong after it has been applied anywhere (including a
teammate's machine, staging, or CI's ephemeral Mongo -- anywhere its
`id` could plausibly already be in another environment's ledger), the fix
is a **new migration file** with a later id that corrects the mistake,
never an edit to the original file or a rollback script.

Rationale:

- A generic `down()` for a data migration (as opposed to a purely
  structural one like adding an index) is often unsafe by the time it
  would run -- if application code has already started writing in the new
  shape, "rolling back" the schema out from under it silently breaks
  writes rather than restoring safety.
- `down()` is very rarely exercised in practice (most teams add it, then
  never run it, and it silently bit-rots against later schema changes),
  which makes it a maintenance cost more than a safety net.
- The one exception is a migration that has **never run anywhere** --
  still sitting in an unmerged branch, never applied to any shared
  environment's ledger. That one may be edited or deleted in place like
  any other unreleased code change; it is not a "fix," because nothing
  depended on it yet.

**What "forward-fix" means operationally:**

1. A migration's `up()` throws, or its `verify()` throws after `up()`
   succeeded: the migration is **not** recorded as applied (see
   DAT-003-T02's `recordApplied()` -- the execution driver DAT-003-T04
   builds must only call it once `up()` *and* `verify()` (if present)
   have both succeeded). The operator fixes the root cause and re-runs
   the same migration file -- this is not a forward-fix, it is a retry of
   a migration the ledger correctly still considers pending.
2. A migration's `up()` succeeded, `verify()` passed (or there was no
   `verify()`), and it is only *later* discovered to be wrong (a
   requirement was misunderstood, an edge case was missed): write a new
   migration file, dated after the original, whose `up()` corrects the
   data/schema left behind by the first one. Its own `verify()` should
   check the corrected end state, not merely that the earlier mistake was
   undone.

## Context

DAT-003-T02 already built the pieces this ADR's policy depends on:
`backend/migrations/ledger.js`'s `recordApplied()` is the single place a
migration is marked done, and `backend/migrations/lock.js`'s
`withMigrationLock()` (fail-closed) is what a real execution driver
(T04) will wrap a run in. Neither of those modules calls `up()` or
`verify()` themselves yet -- T04 is where the actual driver loop
(acquire lock -> for each pending migration: `up()`, then `verify()` if
present, then `recordApplied()` -> release lock) gets built. This ADR
exists so that driver has an unambiguous contract to implement against,
and so migration authors writing `up()`/`verify()` bodies before T04
lands aren't guessing at a shape that changes later.

## Consequences

- DAT-003-T04 (dry-run and batch/resume support) implements the driver
  loop described above, threading a real `dryRun` value into the
  `context` shape this ADR fixes, and calling `recordApplied()` only on
  the success path this ADR defines.
- DAT-003-T06 (first real migration) is written against this contract
  from day one rather than an earlier placeholder.
- `backend/migrations/README.md` is updated alongside this ADR so a
  migration author reads one authoritative convention, not a "TBD, see
  T03" placeholder.
