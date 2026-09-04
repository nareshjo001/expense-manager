# OPS-002-T06: Restoration drill runbook

A step-by-step drill for whoever has real deployment/infrastructure
access to run once T03/T05/T07's backup-and-restore tooling is deployed.
This session cannot run it -- there is no live MongoDB, no `mongodump`/
`mongorestore` binary, and no real backup destination reachable from this
sandbox (the same infrastructure gate DAT-003-T07 and OBS-001-T07 hit for
their own staging-dependent steps). Everything below is concrete and
grounded in exactly what T03/T05/T07 actually built, not a generic
"restore from backup and see what happens" outline -- so it takes an
afternoon to run once someone has access, not a fresh investigation.

Running this drill for real, and recording the result below, is what
turns OPS-002-T06 from "planned" into genuinely Done -- and it is also
the actual validation of [ADR-0005](../decisions/ADR-0005-backup-rpo-rto.md)'s
provisional 4-hour RTO target, which that ADR explicitly says should be
measured here, not assumed.

## Prerequisites

- A deployment with `mongodump`/`mongorestore` available (the MongoDB
  Database Tools package -- `.github/workflows/backup.yml` shows the
  exact apt-based install this repo's CI uses, as a reference).
- A real MongoDB instance with production-shaped data (a staging copy is
  fine and preferable -- **never point `MONGO_CONN` at production for
  this drill**; T05's `mongoRestore.js` refuses to restore INTO
  production, but this drill's setup step, running T03's backup, does
  read from whatever `MONGO_CONN` points at, so use a staging/copy
  database for the whole drill, not production, even though the code
  itself only hard-blocks the restore side).
- `openssl` available on the machine running the drill (already
  confirmed present in this repo's CI and dev sandbox; near-universal on
  Linux/macOS deployment targets).
- A second, genuinely isolated MongoDB instance/database to restore into
  (`RESTORE_TARGET_MONGO_CONN`) -- a throwaway local Mongo container is
  ideal, so a mistake here costs nothing.
- Read `docs/runbooks/OPS-002-backup-restore-operations.md` first for the
  full environment-variable reference (`MONGO_CONN`,
  `BACKUP_ENCRYPTION_KEY`, `RESTORE_TARGET_MONGO_CONN`,
  `BACKUP_DESTINATION_DIR`) before starting the timer below.

## The drill

**Start a stopwatch before step 1.** ADR-0005's 4-hour RTO is measured
from "an operator declares a recovery event" to "restored data is
queryable and reconciled" -- step 1 below is that declaration.

### 1. Declare the (simulated) recovery event

Pick a realistic trigger to simulate -- e.g. "the primary MongoDB
instance is unreachable and the team has decided to restore from the
most recent backup." Note the wall-clock time. This is T=0.

### 2. Confirm a real, recent backup exists

Run `node backend/scripts/backup/checkRecentBackup.js` (or call
`isRecentBackupAvailable()` directly -- see
`backend/scripts/backup/checkRecentBackup.js`) against the configured
`BACKUP_DESTINATION_DIR`. If this drill is starting from a machine with
no backup yet, first run T03's `node backend/scripts/backup/mongoBackup.js`
against the staging source database so there is something real to
restore -- but note the time spent producing that backup separately from
the restore-time measurement below, since in a real incident the backup
would already exist.

### 3. Run the isolated restore (T05)

Set `RESTORE_TARGET_MONGO_CONN` to the throwaway isolated instance (never
production, never the same value as `MONGO_CONN`) and run
`node backend/scripts/backup/mongoRestore.js`. Confirm:

- It refuses immediately if you (deliberately, as a negative test first)
  set `RESTORE_TARGET_MONGO_CONN` equal to `MONGO_CONN` or leave it
  unset -- this is `assertSafeRestoreTarget`'s job, and this drill is
  also the first real-world confirmation that gate actually blocks a
  real misconfiguration, not just a mocked test.
- Once pointed at the real isolated target, it decrypts the backup,
  restores all seven authoritative collections, and reports per-collection
  restored counts.

### 4. Verify data integrity (T07's logic, run manually here)

Compare the restored counts against the source database's real counts
at backup time (T03's manifest records this). Spot-check a handful of
real documents in each of the seven authoritative collections
(`users`, `expenses`, `incomes`, `budgets`, `recurringexpenses`,
`merchantcategoryrules`, `mlfeedbacks` -- see
`backend/scripts/backup/collections.js` for why the real collection
names differ from ADR-0002's table) -- open a few `expenses` documents
and confirm amounts/dates/categories match the source, not just that a
count matches.

### 5. Application-level reconciliation

ADR-0005's RTO definition includes "application-level-reconciled," not
just "data restored." Point a real (non-production) instance of this
app's backend at the restored database (`MONGO_CONN` pointed at the
restored target, for this verification instance only) and confirm: login
works, an expense list loads with correct totals, a budget shows its
correct configured value, and a recurring-expense rule is intact.

### 6. Stop the stopwatch

Record the elapsed time from T=0 (step 1) to the moment step 5 passes.
Compare against ADR-0005's provisional 4-hour RTO target.

## Recording the result

Once run for real, record here (or in the tracker's notes for T06):

- Date run, who ran it, which environment/staging copy was used.
- Elapsed time (T=0 to application-level-reconciled) versus the 4-hour
  target -- if it took longer, say so plainly; per ADR-0005's own
  Consequences section, that means the ADR should be revised to match
  reality, not that the drill result gets quietly ignored.
- Any step that didn't behave as documented above (a gate that didn't
  block when it should have, a count mismatch, anything surprising).
- Whether T06 and OPS-002 as a whole can now be marked genuinely Done.

## Why this session flags rather than runs this

Every prior "flag, don't fake" item this session has produced followed
the same rule: a task needing real infrastructure this sandbox does not
have (a live MongoDB reachable over the wire, `mongodump`/`mongorestore`
binaries, a real deployment target) gets a concrete, ready-to-run
procedure instead of a claimed result. Marking T06 "Done" without
actually running steps 1-6 above against real infrastructure would be
exactly the false confidence OPS-002 exists to prevent -- a backup
system that has never been drilled is unverified by definition, no
matter how carefully T03/T05/T07's code was written and unit-tested.
