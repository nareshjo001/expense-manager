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

- **`.github/workflows/backup-production.yml`** (daily, `workflow_dispatch`
  also available): **this one IS the real thing.** Runs `mongoBackup.js`
  against the actual production database (`MONGO_CONN` sourced from the
  `PROD_MONGO_CONN` repo secret, not the ephemeral service containers the
  two workflows above use) and uploads the resulting encrypted archive +
  manifest as a GitHub Actions workflow artifact. See the next section
  for exactly what to configure, and its caveats.

## Production backup pipeline (BUG-006)

`backup-production.yml` closes the gap the two sections above describe:
production now has a real, scheduled, encrypted backup. Two things to
set up once, and one caveat to know about.

**Required repo secrets** (Settings -> Secrets and variables -> Actions):

| Secret | Value |
|---|---|
| `PROD_MONGO_CONN` | The real production Atlas connection string. **Use a dedicated, read-only database user for this**, not the app's own read-write credential -- mongodump never needs write access, and a backup credential is exactly the kind of thing you don't want able to modify data if it ever leaked. |
| `BACKUP_ENCRYPTION_KEY` | A real, random passphrase, at least 32 characters (e.g. `openssl rand -base64 48`). Store a copy of this somewhere independent of GitHub too (a password manager, etc.) -- if this repo and your only copy of the key are both lost, every encrypted backup becomes permanently unreadable. |

**Atlas network access:** GitHub-hosted runners don't have stable,
allowlist-able IPs (they come from a large, changing Azure range), so
IP-based restriction isn't practical here. The realistic options are (a)
allow `0.0.0.0/0` in Atlas's Network Access list and rely on the
dedicated read-only credential above for security, or (b) run this
workflow on a self-hosted runner with a static IP if you want real IP
restriction. Option (a) is the pragmatic default for a free setup.

**The GitHub-artifacts caveat -- read this before ever running T07
(`removeLegacyMoneyFields.js`):** `backend/scripts/backup/
checkRecentBackup.js` (the function `legacyMoneyRemovalGate.js` calls)
only ever reads **local disk**, via `resolveDestination(env)
.listManifests()`. A GitHub Actions artifact lives on GitHub's servers,
not on any filesystem that gate can see on its own -- so a green
`backup-production.yml` run does NOT, by itself, make the automated
`recentBackup` check pass. Before invoking the T07 removal script (or
any other tool that calls `isRecentBackupAvailable()`), you must:

1. Open the most recent successful `backup-production.yml` run and
   download its `prod-mongo-backup-<run id>` artifact.
2. Unzip it into a local folder (it contains the encrypted archive +
   its manifest, exactly what `mongoBackup.js` would have written to
   `BACKUP_DESTINATION_DIR` directly).
3. Point the gate/removal script at that folder: `BACKUP_DESTINATION_DIR=<that folder>` in its environment.

This is a real, if annoying, manual step -- automating it (e.g. a small
script that lists artifacts via GitHub's REST API and downloads the
newest one, so this becomes one command instead of three manual clicks)
is a natural follow-up, not yet built.

**Storage retention:** artifacts are kept 90 days (GitHub's own maximum)
and pruned automatically after that -- no local `retention.js`-style
pruning applies here, since each run's own runner disk is discarded
regardless. A private repo's total Actions artifact storage counts
against your GitHub plan's overall storage quota; if that ever becomes a
constraint, lower `retention-days` in the workflow rather than the
schedule's frequency.

## What is NOT done here (owner action required)

- **No remote, S3-style backup destination is wired up.**
  `BACKUP_DESTINATION_DIR` (used by all three scripts when run directly,
  e.g. manually or in the CI smoke tests) still defaults to local disk.
  `backend/scripts/backup/destination.js` has a documented, unimplemented
  seam for a real remote destination (S3, GCS, Azure Blob, Cloudflare R2,
  etc.) -- GitHub Actions artifacts (above) cover the "durable, scheduled"
  need for now without picking a vendor, but a real remote destination
  would remove the manual download step above and any artifact-retention
  ceiling. Picking a vendor and provisioning credentials for it is an
  owner decision this task deliberately does not make (no account/
  credentials exist for this task to configure against; see that
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
- **`mongorestore` is pointed at the archive's per-database directory,
  with an explicit `--db` naming the TARGET database** -- not at the
  archive root with `--nsFrom`/`--nsTo`. This is a fix, not a
  preference. The connection string passed via `--config` carries a
  database name, and mongo-tools copies that into its `--db` option
  (`common/options/options.go`: `if opts.DB == "" && cs.Database != ""
  { opts.DB = cs.Database }`). A non-empty `--db` makes `mongorestore`
  treat the directory it is given as a *single-database* directory
  containing `<collection>.bson` files directly, instead of a dump root
  whose subdirectories are database names. Pointed at the root, it found
  no BSON files, restored nothing, and **exited 0** -- the namespace
  flags never got a chance to apply. Only the manifest count check
  caught it. Passing `--db <target>` explicitly and targeting
  `<root>/<mongoDbName>` makes the behaviour independent of whether a
  caller's connection string happens to include a database.
  `backend/tests/backupArchiveLayout.test.js` pins the layout the two
  scripts must agree on, using real `tar` and no MongoDB, so it runs on
  every PR rather than only in the weekly verification job.
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
