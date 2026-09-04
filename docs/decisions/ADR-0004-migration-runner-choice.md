# ADR-0004: Choose a migration runner (DAT-003-T01)

## Decision

Build a minimal, hand-rolled migration runner (`backend/migrations/`)
directly on the existing `connectDB()` / Mongoose / `backend/utils/logger.js`
conventions this codebase already uses, rather than adopting a third-party
migration framework (`migrate-mongo` was the leading alternative
considered).

This task scaffolds only the runner's core shape -- discovering and
validating migration files (`backend/migrations/runner.js`) -- with no
ledger, locking, or actual execution yet. Those are explicitly separate,
already-sequenced tasks: T02 (ledger + locking), T03 (up/verify/forward-fix
conventions), T04 (dry-run/batch/resume), T05 (backup gate), T06 (first
real migration), T07 (CI/staging).

### Why not `migrate-mongo` (or a similar framework)

`migrate-mongo` is the most widely used Node/Mongo migration tool, and was
evaluated first as the default choice. Reasons it was not picked:

- It talks to Mongo through the raw MongoDB driver, not Mongoose -- every
  migration in this codebase would need to either duplicate connection
  config already centralized in `backend/config/db.js`, or bypass
  Mongoose's schema/model layer that every other backend module uses.
- Its dry-run, logging, and CLI conventions are its own -- they don't
  compose with this codebase's existing patterns: `backend/utils/logger.js`'s
  redacted structured events (OBS-001), `--dry-run` as a plain CLI flag
  already used by `scripts/ensureIncomeIdempotencyIndex.js` and
  `scripts/backfillFeedbackStatus.js`, and the backup-gate requirement
  DAT-003-T05 will add (OPS-002 dependency) that no generic migration tool
  knows about.
- It is one more third-party dependency to keep patched and compatible
  with the Mongoose/Mongo driver versions already pinned in
  `package.json`, for a problem this project's own scripts already prove
  is small enough to hand-roll: two migration-shaped scripts already exist
  today (`ensureIncomeIdempotencyIndex.js`, `backfillFeedbackStatus.js`),
  each independently reinventing dry-run support with no shared ledger --
  which is precisely DAT-003's problem statement. The fix is a small
  shared convention over what already exists, not a new framework.

### The convention going forward

- Migration files live in `backend/migrations/scripts/`, one file per
  migration, named so lexicographic sort order is chronological order
  (e.g. `20260903-example-change.js`).
- Each file exports `{ id, description, up, verify }`: `id` and
  `description` are strings, `up` is a required function that applies the
  change, `verify` is an optional function (T03 will define its contract
  in more depth) that checks the change landed correctly.
- `backend/migrations/runner.js` discovers and validates these files
  (`loadMigrations`) and can plan what is pending (`planPending`) --
  today, "pending" means "every migration that exists," because there is
  no ledger yet to know which have already run. Actually applying a
  migration is deferred until T02 adds that ledger: running one for real
  today, with no record that it ran, would let the exact same migration
  silently reapply on every server restart.

## Context

`backend/server.js` and `backend/scripts/` currently rely on ad hoc,
independently-invoked scripts for schema/index evolution, with no shared
ledger recording what has already been applied to a given environment.
That is DAT-003's audit finding, and it is visible today in the two
existing scripts named above -- both already implement `--dry-run`
manually, both already log manually, and neither knows about the other or
about anything that ran before it.

## Consequences

- DAT-003-T02 builds the ledger and locking directly on top of
  `loadMigrations()`/`planPending()` -- it does not need to re-solve file
  discovery or shape validation.
- DAT-003-T03's up/verify/forward-fix conventions extend the `verify`
  export contract this ADR already names but does not fully specify.
- No new runtime dependency was added to `package.json`.
- If a future migration's needs genuinely outgrow this (e.g. multi-region
  coordination, a large migration backlog needing a richer CLI), revisit
  this ADR rather than silently reaching for a framework mid-project.
