# Database migrations (DAT-003)

See [ADR-0004](../../docs/decisions/ADR-0004-migration-runner-choice.md)
for why this is a small hand-rolled runner rather than a third-party
migration framework, and
[ADR-0006](../../docs/decisions/ADR-0006-migration-up-verify-forward-fix-conventions.md)
for the full `up`/`verify` contract and the forward-fix-only policy
summarized below.

## Status

`runner.js` discovers and validates migration files (DAT-003-T01).
`lock.js` and `ledger.js` provide a fail-closed exclusive lock and a
durable applied-migrations record (DAT-003-T02). The `up`/`verify`
contract and forward-fix policy are fixed (DAT-003-T03, this doc).

**There is still no execution driver that actually calls a migration's
`up()`** -- that is DAT-003-T04 (dry-run/batch/resume) and DAT-003-T05
(backup gate). Do not call a migration's `up()` by hand outside a future
driver; the lock and ledger only protect a run that goes through the
driver DAT-003-T04 builds.

## Convention

Each migration is one file in `scripts/`, named so lexicographic sort
order is chronological order:

```
scripts/20260903-example-change.js
```

and exports:

```js
module.exports = {
  id: "20260903-example-change",
  description: "Short human-readable summary of what this migration does",
  async up({ mongoose, logger, dryRun }) {
    // Apply the change. Treat dryRun: true as "compute and log what would
    // change, write nothing." Prefer operations that tolerate
    // re-application (updateMany with a filter, createIndex, $setOnInsert)
    // over ones that assume a pristine starting state. Throw on failure --
    // never catch-and-swallow, since a caught error here still gets
    // recorded as a successful migration by the future execution driver.
  },
  async verify({ mongoose, logger }) {
    // Optional, but recommended for anything non-trivial. Read-only --
    // check the outcome (e.g. query indexes(), don't just trust
    // createIndex() resolved). Throw if the post-condition doesn't hold;
    // that throw is what signals "ran, but didn't produce the expected
    // result" rather than quiet success.
  },
};
```

`id` and `description` must be non-empty strings, `up` must be a
function, and `verify` (when present) must be a function --
`runner.js`'s `loadMigrations()` throws immediately, naming the offending
filename, if a migration file does not match this shape.

## No `down()` -- forward-fix only

This runner will never gain a rollback export. If a migration turns out
to be wrong **after it has been applied anywhere** (a teammate's machine,
staging, CI), the fix is a new migration file with a later id that
corrects the mistake -- never an edit to the original file or a rollback
script. A migration that has never run anywhere (still on an unmerged
branch) may be edited or deleted freely like any other unreleased code
change. See ADR-0006 for the full rationale.

## DAT-003-T07 status: the CI half is confirmed, the staging half is not

T07 is "run migrations in CI and staging". Recording where each half stands,
because the earlier note on this task said the CI half was wired but had
"not run yet" and that is no longer true.

**CI: confirmed green.** `.github/workflows/ci.yml`'s `backend-integration`
job runs `node migrations/run.js --dry-run` and then a real apply against
its own throwaway `mongo:7` service container. That is the only place in
this pipeline where the full driver + ledger + lock + a real migration
execute against actual MongoDB rather than a fake. It has run on every push
and pull request since 2026-09-03 and has passed on each — including the
runs for PRs #24 through #27, where the aggregate `ci-required` job reported
`backend-integration` as `success`.

`--allow-no-backup-check` is passed there, and is legitimate *only* because
that Mongo container is destroyed at the end of every run. Never pass it
against an environment with data.

**Staging: not run.** This needs a deployed environment, which does not yet
exist. When it does, the sequence is:

```bash
node migrations/run.js --dry-run     # read the plan, confirm it is expected
node migrations/run.js               # apply, WITHOUT --allow-no-backup-check
```

The second command deliberately keeps the backup safety gate
(`environmentGate.js`) armed, so it refuses unless a recent verified backup
exists — which OPS-002-T03 now provides and
`.github/workflows/backup-verify.yml` exercises end to end.

If Redis is unreachable the run **refuses** rather than proceeding
unlocked: the lock is what stops two concurrent deploys applying the same
migration to the same database, and unlike a cache miss there is no
fallback for that. See `run.js`'s own comment — that refusal is correct
behaviour, and the fix is to restore Redis, not to bypass it.
