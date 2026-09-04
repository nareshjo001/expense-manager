# OPS-002 backup and restore operations

Covers OPS-002-T03 (encrypted Mongo backups), T05 (isolated restore
procedure), and T07 (recurring restore verification + alerts). Builds on
[ADR-0002](../decisions/ADR-0002-authoritative-vs-disposable-stores.md)
(what is backed up) and [ADR-0005](../decisions/ADR-0005-backup-rpo-rto.md)
(the provisional RPO/RTO/retention targets this tooling builds against).

## What is backed up

The 7 collections ADR-0002 classifies as authoritative. **Important:**
ADR-0002's table lists mongoose *model registration names*, not the real
MongoDB collection names -- `backend/scripts/backup/collections.js` is
the verified, single source of truth for the real names mongodump and
mongorestore actually use:

| ADR-0002 label | Real MongoDB collection name |
|---|---|
| `users` | `users` |
| `expenses` | `expenses` |
| `incomes` | `incomes` |
| `budget` | `budgets` |
| `mlFeedback` | `mlfeedbacks` |
| `RecurringExpense` | `recurringexpenses` |
| `MerchantCategoryRule` | `merchantcategoryrules` |

Everything else (Redis, `Report`, `PendingSync`, `RefreshSession`,
`SiaRequest`, `DeviceToken`, `Notification`, `SiaSession`, `SiaMessage`)
is out of scope -- see ADR-0002 for why.

## Required environment variables

| Env var | Used by | Purpose |
|---|---|---|
| `MONGO_CONN` | `mongoBackup.js` | Source database to back up. Same variable the app itself uses (`backend/config/db.js`). Never read by `mongoRestore.js`/`verifyBackupRestore.js` except to *compare against* `RESTORE_TARGET_MONGO_CONN` -- never as a connection target in those scripts. |
| `BACKUP_ENCRYPTION_KEY` | all three scripts | Passphrase used for the backup archive's encryption and its HMAC integrity check. **This code never generates, stores, or defaults this value.** Must be at least 32 characters. Losing it means the encrypted archives are permanently unreadable -- store it in a real secrets manager, not in this repo or in CI logs. |
| `RESTORE_TARGET_MONGO_CONN` | `mongoRestore.js`, `verifyBackupRestore.js` | The **only** database a restore is ever allowed to write into. Must be set, non-empty, and different from `MONGO_CONN` (a plain string compare) -- the script refuses to run otherwise. Point it at a genuinely disposable/scratch database. |
| `BACKUP_DESTINATION_DIR` | all three scripts | Local filesystem directory backups are read from/written to. Defaults to `backend/scripts/backup/.backups` if unset. **This is local disk only** -- see "What is NOT done here" below. |
| `BACKUP_DESTINATION_TRANSPORT` | all three scripts | Defaults to `local-fs` (the only implemented transport). Any other value throws immediately rather than silently falling back. |
| `BACKUP_RETENTION_COUNT` | `mongoBackup.js` | Defaults to 35 (ADR-0005's provisional target). Count-based: the newest N backups are kept, everything older is pruned after each successful run. |
| `BACKUP_FRESHNESS_MAX_AGE_HOURS` | the migration environment gate (`backend/migrations/environmentGate.js`) | Defaults to 30 (ADR-0005's 24h RPO plus ~6h of scheduling slack). How old the newest manifest is allowed to be before `checkRecentBackupExists()` starts refusing to let non-dry-run migrations run. |
| `OBS_ALERT_OWNER_EMAIL` | `verifyBackupRestore.js` (indirectly, via `backend/utils/alerts.js`) | If set, a `backup_restore_verification_failed` alert is also emailed here, same as every other OBS-001 alert. Optional -- unset means structured-log-only, which is a valid configuration. |

## Running each script manually

All three are run from the `backend/` directory.

**Take a backup (T03):**

```
MONGO_CONN="mongodb://127.0.0.1:27017/expense_manager" \
BACKUP_ENCRYPTION_KEY="a-long-random-passphrase-at-least-32-chars" \
node scripts/backup/mongoBackup.js
```

Dumps the 7 authoritative collections (one `mongodump` invocation per
collection), tars and gzips the dump, encrypts it, writes it plus a JSON
manifest sidecar to `BACKUP_DESTINATION_DIR`, then prunes anything past
the retention count.

**Restore a backup into an isolated target (T05):**

```
RESTORE_TARGET_MONGO_CONN="mongodb://127.0.0.1:27017/expense_manager_restore_scratch" \
BACKUP_ENCRYPTION_KEY="a-long-random-passphrase-at-least-32-chars" \
node scripts/backup/mongoRestore.js [--backup-id <id>]
```

Restores the most recent backup by default (or a specific one via
`--backup-id`, matching a manifest's `backupId`). Refuses immediately if
`RESTORE_TARGET_MONGO_CONN` is unset, empty, or equal to `MONGO_CONN`.
Verifies restored document counts per collection against the manifest and
exits non-zero on any mismatch.

**Run a recurring verification pass (T07):**

```
RESTORE_TARGET_MONGO_CONN="mongodb://127.0.0.1:27017/expense_manager_verify_scratch" \
BACKUP_ENCRYPTION_KEY="a-long-random-passphrase-at-least-32-chars" \
node scripts/backup/verifyBackupRestore.js
```

Runs the same isolated restore as T05 against the most recent backup and
fires a `backup_restore_verification_failed` alert (via
`backend/utils/alerts.js`'s existing `dispatchAlerts` -- see
[docs/runbooks/OBS-001-alerts.md](OBS-001-alerts.md)) on any failure: no
backup found, the restore itself throwing, or a document-count mismatch.

## What the CI schedules do

- **`.github/workflows/backup.yml`** (daily, `workflow_dispatch` also
  available): seeds one fixture document into its own throwaway `mongo:7`
  service container, runs `mongoBackup.js` against it, and asserts a
  manifest and encrypted archive were actually written.
- **`.github/workflows/backup-verify.yml`** (weekly): seeds fixture data,
  runs `mongoBackup.js`, then runs `verifyBackupRestore.js` restoring into
  a second database name on the same ephemeral Mongo service (standing in
  for an isolated restore target).

**Both are real, working smoke tests of this tooling against a real,
ephemeral MongoDB -- neither is connected to, or capable of reaching, a
real production database.** They prove the scripts function correctly
end-to-end; they do not by themselves constitute a production backup
schedule. See the next section.

## What is NOT done here (owner action required)

- **No real production backup schedule exists yet.** `backup.yml` runs
  against its own job-local ephemeral Mongo, not a real production
  `MONGO_CONN`. Actually protecting production data requires a scheduled
  job (a cron on a real server, a scheduled cloud function/task, etc.)
  that has real network access to the production database and a real,
  securely-stored `BACKUP_ENCRYPTION_KEY` -- that is an owner
  infrastructure decision, not made by this task.
- **No remote backup destination is wired up.** `BACKUP_DESTINATION_DIR`
  defaults to local disk. `backend/scripts/backup/destination.js` has a
  documented, unimplemented seam for a real remote destination (S3, GCS,
  Azure Blob, etc.) -- picking a vendor and provisioning credentials for
  it is an owner decision this task deliberately does not make (no
  account/credentials exist for this task to configure against; see that
  file's header comment for exactly what to implement to add one).
  **Local-disk-only backups do not survive the loss of the machine they
  run on** -- treat this as incomplete disaster-recovery coverage until a
  remote destination is added.
- **`BACKUP_ENCRYPTION_KEY` is not generated, stored, or rotated by any
  of this code.** An owner must generate a strong passphrase, store it in
  a real secrets manager, and provide it to these scripts via environment
  variable. Losing it means every existing encrypted backup becomes
  permanently unreadable -- back the key up somewhere independent of the
  backups it protects.
- ADR-0005's RPO/RTO/retention numbers this tooling builds against are
  **provisional (Status: PROPOSED)**, not yet owner-approved -- see that
  ADR's "Approval" section.

## Design notes worth knowing

- **Encryption is AES-256-CBC + HMAC-SHA256 (encrypt-then-MAC), not
  AES-256-GCM.** The task spec suggested `openssl enc -aes-256-gcm`; a
  real, live test on the dev host this was built on confirmed `openssl
  enc` (the CLI subcommand this code shells out to) does not support any
  AEAD cipher at all -- it fails immediately with "AEAD ciphers not
  supported," a long-standing limitation of that specific subcommand, not
  a version quirk. `backend/scripts/backup/encryption.js`'s header
  documents this in full; the HMAC (computed with Node's built-in
  `crypto`, not a new dependency) is verified *before* any decryption is
  attempted, so a corrupted or tampered archive is rejected outright.
- **`mongodump --collection` is looped once per collection**, not a
  single `--nsInclude` glob invocation -- see
  `backend/scripts/backup/mongoBackup.js`'s header comment for why (both
  approaches end up listing every included collection explicitly to stay
  scoped to just the 7 authoritative ones; the loop is simpler to reason
  about and test one collection's argv at a time).
- **The Mongo connection string is never passed as a plain CLI
  argument.** Both `mongodump`/`mongorestore` invocations use `--config
  <temp-yaml-file>` (mode 0600, deleted immediately after) instead of
  `--uri`, so a credential-bearing connection string never appears in
  `ps aux` output on a shared host.
- **Retention is count-based (newest 35 kept), not age-based** (delete
  after 35 days) -- `backend/scripts/backup/retention.js`'s header
  explains why: it matches ADR-0005's literal wording and degrades safely
  if a scheduled run is ever missed.
- **`backend/migrations/environmentGate.js`'s `checkRecentBackupExists()`
  is now real**, not the permanent fail-closed stub it used to be before
  OPS-002-T03. It delegates to
  `backend/scripts/backup/checkRecentBackup.js`, which checks whether the
  newest manifest at the configured destination is within
  `BACKUP_FRESHNESS_MAX_AGE_HOURS`. Signature and fail-closed default are
  unchanged -- any error (including "no manifests exist yet") still
  resolves to `false`.
