# DAT-002-T01: Schema and index inventory

Inventories every Mongoose schema, its real MongoDB collection name, every
field it declares, and every index it declares (schema-level or migration
-level), so DAT-002-T02 (canonical email/month representations) and
DAT-002-T03 (timestamps and operational compound indexes) target real,
verified gaps instead of guessing. Cross-references
[ADR-0002](../decisions/ADR-0002-authoritative-vs-disposable-stores.md)
(authoritative vs. disposable store classification) and the DAT-003-T06
index migration, since both already touch a subset of this same ground.

Method: every schema in `backend/config/Schemas.js` and every file in
`backend/models/*.js` was read directly (16 `mongoose.model(...)` calls
total -- confirmed by grepping the whole `backend/` tree, excluding
`node_modules` and `tests/`, for `mongoose.model(`). Every collection name
below was verified by actually requiring each model file in Node and
reading `<Model>.collection.name` -- not assumed from Mongoose's
pluralization rules by eye (see "Verification" at the end of this
document).

## 1. Every schema and its real collection name

| # | Model registration name | File | Real MongoDB collection | `timestamps` option |
|---|---|---|---|---|
| 1 | `'expenses'` | `config/Schemas.js` (`expenseSchema`) | `expenses` | No |
| 2 | `'users'` | `config/Schemas.js` (`userSchema`) | `users` | No |
| 3 | `'incomes'` | `config/Schemas.js` (`IncomeSchema`) | `incomes` | No |
| 4 | `'budget'` | `config/Schemas.js` (`budgetSchema`) | `budgets` | No |
| 5 | `'mlFeedback'` | `config/Schemas.js` (`MlFeedbackSchema`) | `mlfeedbacks` | Yes |
| 6 | `'DeviceToken'` | `models/DeviceToken.js` | `devicetokens` | Yes |
| 7 | `'MerchantCategoryRule'` | `models/MerchantCategoryRule.js` | `merchantcategoryrules` | Yes |
| 8 | `'MigrationLedger'` | `models/MigrationLedger.js` | `migrationledgers` | Yes |
| 9 | `'Notification'` | `models/Notification.js` | `notifications` | No (manual `createdAt` field only, no `updatedAt`) |
| 10 | `'PendingSync'` | `models/PendingSync.js` | `pendingsyncs` | Yes |
| 11 | `'recurringExpenses'` | `models/RecurringExpense.js` (`RecurringExpenseSchema`) | `recurringexpenses` | No |
| 12 | `'RefreshSession'` | `models/RefreshSession.js` | `refreshsessions` | Yes |
| 13 | `'FinancialReport'` | `models/Report.js` (`financialReportSchema`) | `financialreports` | Yes |
| 14 | `'SiaMessage'` | `models/SiaMessage.js` | `siamessages` | Yes |
| 15 | `'SiaRequest'` | `models/SiaRequest.js` | `siarequests` | Yes |
| 16 | `'SiaSession'` | `models/SiaSession.js` | `siasessions` | Yes |

Row 4 (`budget` -> `budgets`) and row 5 (`mlFeedback` -> `mlfeedbacks`)
already had this exact mismatch documented in `ADR-0002` and
`backend/scripts/backup/collections.js` (OPS-002-T03) for the 7
"authoritative" collections; the table above extends that same verified
mapping to all 16 models, since DAT-002's later tasks (index creation,
migrations) need the real collection name for every store, not just the
authoritative seven.

**Note on row 9:** `Notification.js` sets `createdAt` as a plain schema
field with `default: Date.now` instead of using Mongoose's `{ timestamps:
true }` option. This works for creation time but the collection has no
`updatedAt` field at all -- there is no path in the codebase that ever
updates a notification document's mutable fields (`pushStatus`,
`retryCount`, `nextRetryAt`) while recording when that update happened.

## 2. Field inventory by schema

### 2.1 `expenseSchema` (`config/Schemas.js`, collection `expenses`)

| Field | Type | Required / default | Notes |
|---|---|---|---|
| `userId` | `ObjectId` (ref `'users'`) | required | Ownership field. |
| `id` | `String` | required | Client-generated per-expense id, unique per user (see index below), NOT the Mongo `_id`. |
| `expenseName` | `String` | required | |
| `expenseCategory` | `String` | required | Free-text; CAT-001 normalizes at the controller boundary, not schema-enforced. |
| `expenseAmount` | `Number` | required | Authoritative amount (float). |
| `expenseAmountMinor` | `Number` | optional | DAT-001-T04 shadow integer-paise field; flag-gated dual-write via `attachMoneyMinorSync`. |
| `expenseDate` | `Date` | required | |
| `expenseDescription` | `String` | default `""` | |
| `isRecurring` | `Boolean` | default `false` | |
| `mlPredictedCategory` | `String` | default `""` | |
| `mlConfidence` | `Number` | default `0` | |
| `wasMlCorrected` | `Boolean` | default `false` | |
| `wasMlAbstained` | `Boolean` | default `false` | ML-003-T05. |

No `timestamps` option -- an expense document has no `createdAt`/`updatedAt`
of its own; `expenseDate` is a user-entered transaction date, not a record
audit timestamp.

### 2.2 `userSchema` (`config/Schemas.js`, collection `users`)

| Field | Type | Required / default | Notes |
|---|---|---|---|
| `fullName` | `String` | required | |
| `email` | `String` | required, `unique: true` | Case-sensitive today -- no `lowercase: true`/collation on the schema itself; AUTH-002's service layer normalizes on write, not the schema (this is exactly the gap DAT-002-T02 is scoped to close). |
| `password` | `String` | required | Hashed at the service layer (out of scope for this inventory). |
| `otp` | `String` | optional | |
| `otpExpiry` | `Date` | optional | |
| `lastOtpSent` | `Date` | optional | |
| `isVerified` | `Boolean` | default `false` | |
| `isPasswordReset` | `Boolean` | default `false` | |
| `passwordResetExpiry` | `Date` | optional | |
| `verificationExpiresAt` | `Date` | optional, field-level TTL index (`expireAfterSeconds: 0`) | See index table -- this is a conditional/absolute-expiry TTL, not a fixed rolling one. |

No `timestamps` option -- no `createdAt` recording account-creation time.

### 2.3 `IncomeSchema` (`config/Schemas.js`, collection `incomes`)

| Field | Type | Required / default | Notes |
|---|---|---|---|
| `userId` | `ObjectId` (ref `'users'`) | required | |
| `incomeSource` | `String` | required | |
| `incomeAmount` | `Number` | required | |
| `incomeAmountMinor` | `Number` | optional | Same DAT-001-T04 shadow pattern as `expenseAmountMinor`. |
| `incomeDate` | `Date` | required | |
| `idempotencyKey` | `String` | default `undefined` | Remediation Workstream B; `undefined` default (not `null`) so the field is omitted entirely unless a caller supplies one -- required for the partial unique index below to work correctly. |

No `timestamps` option.

### 2.4 `budgetSchema` (`config/Schemas.js`, collection `budgets`)

| Field | Type | Required / default | Notes |
|---|---|---|---|
| `userId` | `ObjectId` (ref `'users'`) | required | |
| `month` | `String` | required | Free-text today (e.g. presumed `"YYYY-MM"` by convention, not schema-enforced format/pattern). This is exactly the representation DAT-002-T02 is scoped to canonicalize. |
| `budget` | `Number` | required, `min: 0` | |
| `budgetMinor` | `Number` | optional | DAT-001-T04 shadow field. |
| `spent` | `Number` | required, `min: 0` | Derived/recalculated, not user-entered -- see `budget.service.js`'s `recalculateBudget()`. |
| `spentMinor` | `Number` | optional | DAT-001-T04 shadow field. |
| `syncRevision` | `Number` | default `0` | Phase C.2 write-fencing generation stamp. |

No `timestamps` option.

### 2.5 `MlFeedbackSchema` (`config/Schemas.js`, collection `mlfeedbacks`)

| Field | Type | Required / default | Notes |
|---|---|---|---|
| `expenseName` | `String` | required | |
| `predictedCategory` | `String` | required | |
| `actualCategory` | `String` | required | |
| `confidence` | `Number` | default `0` | |
| `corrected` | `Boolean` | default `false` | Legacy field, kept for backward compatibility. |
| `abstained` | `Boolean` | default `false` | ML-003-T05. |
| `outcome` | `String` enum (`accepted`\|`corrected`\|`viewed`\|`abstained`) | default `null` | ML-003-T05; `null` for every pre-T05 document. |
| `status` | `String` enum (`pending`\|`reserved`\|`trained`\|`needs_review`) | default `null` | Feedback lifecycle (Phase A). |
| `trainingRunId` | `ObjectId` | default `null` | No `ref` declared (no training-run model exists yet in Mongo). |
| `attempts` | `Number` | default `0`, `min: 0` | |
| `lastError` | `String` | default `null` | |
| `reservedAt` | `Date` | default `null` | |
| `trainedAt` | `Date` | default `null` | |
| `userId` | `ObjectId` (ref `'users'`) | optional (no `required`) | Only schema in this inventory where a `userId`/owner field is present but NOT `required: true`. |

Has `{ timestamps: true }`.

### 2.6 `RecurringExpenseSchema` (`models/RecurringExpense.js`, collection `recurringexpenses`)

| Field | Type | Required / default | Notes |
|---|---|---|---|
| `userId` | `ObjectId` (ref `'users'`) | required | |
| `expenseId` | `ObjectId` (ref `'expenses'`) | required | Points at the most recently materialized expense document. |
| `expenseName` | `String` | required | |
| `expenseCategory` | `String` | required | |
| `expenseAmount` | `Number` | required | |
| `expenseAmountMinor` | `Number` | optional | DAT-001-T04 shadow field. |
| `lastLoggedDate` | `Date` | required | |
| `nextDueDate` | `Date` | required | |

No `timestamps` option -- confirmed as one of the two gaps the existing
2026-09-08 forensic audit note (feature doc section "Audit status")
already named.

### 2.7 `DeviceToken` (`models/DeviceToken.js`, collection `devicetokens`)

| Field | Type | Required / default | Notes |
|---|---|---|---|
| `userId` | `ObjectId` (ref `'users'`) | required | No explicit index on `userId` alone (see gap 3.3). |
| `token` | `String` | required, `unique: true` | |
| `platform` | `String` enum (`web`\|`mobile`) | required | |
| `notificationPreview` | `String` enum (`generic`\|`detailed`) | default `"generic"`, required | NOT-002-T02. |

Has `{ timestamps: true }`.

### 2.8 `MerchantCategoryRule` (`models/MerchantCategoryRule.js`, collection `merchantcategoryrules`)

| Field | Type | Required / default | Notes |
|---|---|---|---|
| `userId` | `ObjectId` (ref `'users'`) | required | |
| `merchantKey` | `String` | required | Pre-normalized (`utils/merchantNormalization.js`) before every write. |
| `category` | `String` | required | Pre-normalized (`utils/categoryNormalization.js`) before every write. |

Has `{ timestamps: true }`.

### 2.9 `MigrationLedger` (`models/MigrationLedger.js`, collection `migrationledgers`)

| Field | Type | Required / default | Notes |
|---|---|---|---|
| `migrationId` | `String` | required, `unique: true` | Matches a migration file's exported `id`. |
| `description` | `String` | required | Denormalized copy, survives file rename/deletion. |
| `appliedAt` | `Date` | required, default `Date.now` | |
| `durationMs` | `Number` | optional, `min: 0` | |

Has `{ timestamps: true }`. Operational metadata, not user data -- has no
`userId`/owner field at all (correctly, since it is not user-scoped).

### 2.10 `Notification` (`models/Notification.js`, collection `notifications`)

| Field | Type | Required / default | Notes |
|---|---|---|---|
| `userId` | `ObjectId` (ref `'users'`) | required | No explicit index on `userId` (see gap 3.3). |
| `title` | `String` | optional | |
| `message` | `String` | optional | |
| `type` | `String` | optional | Free-text (`recurring-expense`, `system`, etc.), not an enum. |
| `relatedId` | `ObjectId` (ref `'expenses'`) | optional | |
| `pushStatus` | `String` enum (`pending`\|`sent`\|`failed`) | default `"pending"` | |
| `retryCount` | `Number` | default `0` | |
| `nextRetryAt` | `Date` | default `null` | |
| `createdAt` | `Date` | default `Date.now` | Manual field, not the `{ timestamps: true }` option -- see 1's note. |

### 2.11 `PendingSync` (`models/PendingSync.js`, collection `pendingsyncs`)

One document per user (`user` is `unique: true` + `index: true`). Full
field list omitted here since every field's purpose is already documented
exhaustively in the schema file's own header/inline comments (crash-gap
closure, reservation ownership, legacy-field migration path) -- duplicating
that narrative would drift from the source of truth. Summary relevant to
this inventory: `user` (ObjectId, ref `'users'`, required, unique, indexed),
`revision` (Number), `pendingBudgetMonths` (Date array), `reportPending`
(Boolean), `lastError` (String, `maxlength: 500`), `lastAttemptAt` (Date),
`reservedBudgetMonths` / `reservedReports` / `reservedUserWideReservations`
(sub-document arrays, no `_id`), `reservedReport` / `reservedUserWide`
(legacy single-object sub-documents, `default: undefined`, read-and-clear
only per the file's own comment). Has `{ timestamps: true, versionKey:
false }`.

### 2.12 `RefreshSession` (`models/RefreshSession.js`, collection `refreshsessions`)

| Field | Type | Required / default | Notes |
|---|---|---|---|
| `userId` | `ObjectId` (ref `'users'`), `index: true` | required | |
| `tokenHash` | `String` | required, `unique: true` | |
| `csrfHash` | `String` | required | |
| `expiresAt` | `Date`, field-level TTL index (`expireAfterSeconds: 0`) | required | |
| `revokedAt` | `Date`, `index: true` | default `null` | |
| `userAgentHash` | `String` | default `null` | |
| `lastUsedAt` | `Date` | default `null` | |

Has `{ timestamps: true, versionKey: false }`.

### 2.13 `financialReportSchema` (`models/Report.js`, collection `financialreports`)

| Field | Type | Required / default | Notes |
|---|---|---|---|
| `user` | `ObjectId`, `ref: "User"`, `unique: true`, `index: true` | required | **`ref` mismatch -- see gap 3.1.** |
| `metadata` | `Mixed` | required | |
| `summary` / `spending` / `budgets` / `categories` / `trends` / `habits` / `financialHealth` / `forecast` / `anomalies` | `Mixed` | default `{}` | Nine untyped sections -- exactly what DAT-002-T04 ("Type stable report fields and add schemaVersion") is scoped to address. No `schemaVersion` field exists today, confirming the 2026-09-08 audit note verbatim. |
| `syncRevision` | `Number` | default `0` | Phase C.2 write-fencing stamp, same pattern as `budgetSchema.syncRevision`. |

Has `{ timestamps: true, versionKey: false }`.

### 2.14 `SiaMessage` / `SiaRequest` / `SiaSession` (`models/Sia*.js`)

All three are already extensively self-documented (deliberately-omitted
field lists per file header: raw prompts, provider responses and API keys
are never stored) and were built recently (SIA workstreams) with
`{ timestamps: true, versionKey: false }` and correct `ref` strings
throughout (`'users'`, `'SiaSession'` -- both verified against section 1's
table). No gaps found in these three; included in the index table (3.2)
for completeness since DAT-002-T03/T07 need the full index picture, not a
subset.

## 3. Known gaps (documented, not fixed -- in scope for DAT-002-T02 through T07)

### 3.1 `Report.js`'s `user.ref` does not match the registered `users` model name

`models/Report.js` declares `ref: "User"` (capitalized, singular) on its
`user` field, but `UserModel` is registered as `mongoose.model('users',
userSchema)` (lowercase, plural) in `config/Schemas.js`. Mongoose's
`ref` resolution is an exact string match against a registered model name,
so `FinancialReport.findOne(...).populate('user')` would silently fail to
resolve (return `null`/leave the field as a bare ObjectId) if it were ever
called.

**Confirmed latent, not currently triggered:** grepped the whole
`backend/` tree (excluding `node_modules`/`tests/`) for `.populate(` --
zero matches anywhere in the codebase. `Services/reportService.js` only
ever calls `.findOne()`/`.findOneAndUpdate()`/`.lean()` on
`FinancialReport`, never `.populate()`. This is a real, confirmed schema
defect, but it has never actually broken anything because nothing exercises
the code path it would break. Flagging here rather than fixing, since a
one-line `ref` fix is a trivial follow-up but is out of this task's
"inventory only" scope.

### 3.2 Only 6 of the ~20 declared indexes are covered by an explicit migration

`backend/migrations/scripts/20260903-ensure-core-indexes.js` (DAT-003-T06)
explicitly (re-)creates exactly 6 indexes: `expenses`'s two, `incomes`'s
one, `budget`'s one, and `recurringExpenses`'s two. Its own header comment
already states the reason this matters -- these are otherwise created only
by Mongoose's `autoIndex` option, which is at its default (`true`)
everywhere in this codebase (confirmed: no `autoIndex` override anywhere
in `backend/config/db.js` or any connection call, only comments referencing
the default behavior).

The migration's own scope note says it covers what
"`config/Schemas.js` and `models/RecurringExpense.js` already declare" --
accurate as written, but that leaves every index declared in
`models/*.js` files outside those two, plus one index inside
`config/Schemas.js` itself, uncovered by any explicit migration:

- `IncomeSchema`'s partial unique idempotency index (`{ userId,
  idempotencyKey }`, in `config/Schemas.js` -- NOT in the migration despite
  being in the same file the migration's comment names).
- `MlFeedbackSchema` -- no indexes declared in the schema at all (see 3.4).
- `DeviceToken.token` (`unique: true`).
- `MerchantCategoryRule`'s `{ userId, merchantKey }` unique index.
- `RefreshSession`'s `tokenHash` unique index, `expiresAt` TTL index,
  `userId`/`revokedAt` field-level indexes, and its `{ userId, revokedAt,
  expiresAt }` compound index.
- `FinancialReport`'s `user` unique index.
- `SiaMessage`'s two indexes, `SiaRequest`'s two indexes (including its own
  TTL), `SiaSession`'s one index.
- `MigrationLedger.migrationId` (`unique: true`).
- `userSchema.verificationExpiresAt` TTL index.
- `PendingSync.user` unique index.

**Consequence, stated plainly:** today this is not a live problem, since
`autoIndex` defaults to `true` and nothing in this codebase turns it off.
It becomes a real risk only if a future deploy disables `autoIndex` (a
common production practice for large collections, exactly as the existing
migration's own comment already argues for the 6 it covers) without first
extending this migration to the other ~14 indexes -- at that point every
uniqueness guarantee and TTL expiry listed above would silently stop being
enforced with no error at connection time. Documented here as a known gap
for DAT-002/DAT-003 to close, not fixed in this task.

### 3.3 `DeviceToken.userId` and `Notification.userId` have no index at all

Every other user-owned collection in this codebase indexes its ownership
field in some form (a plain `index: true`, or as the leading key of a
compound index). `DeviceToken.userId` and `Notification.userId` are the
two exceptions -- an unindexed field, on a collection scoped to a single
user, forces a full collection scan for "all of this user's device
tokens"/"all of this user's notifications" lookups. Confirmed by reading
both schema files directly (section 2.7, 2.10) -- neither declares
`index: true` on `userId`, nor an equivalent `schema.index({ userId: 1
})` call.

### 3.4 `MlFeedbackSchema` has zero indexes declared

Every query against the `mlfeedbacks` collection (feedback-lifecycle
reservation, retraining export, per-user feedback lookups in
`feedback_repository.py`/the Node-side collector) runs against a schema
with no `schema.index(...)` call anywhere in its definition -- not even on
`userId` or `status`, the two fields the feedback lifecycle (`status`:
`pending`/`reserved`/`trained`/`needs_review`) filters on most. Confirmed
by reading `config/Schemas.js` in full (section 2.5) -- the only
`.index(...)` calls in that file target `expenseSchema`, `budgetSchema`
and `IncomeSchema`.

### 3.5 Six schemas have no `timestamps` at all; `Notification` has half

Listed in section 1's table: `expenseSchema`, `userSchema`, `IncomeSchema`,
`budgetSchema`, `RecurringExpenseSchema` have no `createdAt`/`updatedAt`
whatsoever, and `Notification` has a manual `createdAt` but no `updatedAt`.
This is the concrete target list for DAT-002-T03 ("Add timestamps and
operational compound indexes") -- confirms and slightly extends the
existing 2026-09-08 forensic audit note, which named only
`Notification.js` and `RecurringExpense.js` explicitly.

### 3.6 `MigrationLedger` is not classified in ADR-0002's authoritative/disposable table

[ADR-0002](../decisions/ADR-0002-authoritative-vs-disposable-stores.md)
classifies 7 collections as authoritative and 8 as disposable/derived --
15 of this inventory's 16 models. `MigrationLedger` (added by DAT-003-T02,
after ADR-0002 was written) appears in neither list. It is almost
certainly disposable/derived in spirit -- it is operational bookkeeping
recording which migrations already ran, not user or financial data, and
its own file comment already frames it as durable-but-operational
metadata -- but that classification has never actually been recorded
anywhere. Flagging for whoever owns ADR-0002 to add a follow-up row or ADR,
consistent with how `backend/scripts/backup/collections.js` (OPS-002-T03)
already handled finding a discrepancy in that same document: flag it to
its owner rather than editing an already-shipped ADR from an unrelated
task.

## 4. Full index table (schema-declared, all 16 models)

| Collection | Index keys | Options | Purpose |
|---|---|---|---|
| `users` | `{ email: 1 }` | `unique: true` (field-level) | Login lookup, one account per email address. |
| `users` | `{ verificationExpiresAt: 1 }` | `expireAfterSeconds: 0` (field-level TTL) | Expires the field's own value as an absolute timestamp, not a fixed document lifetime. |
| `expenses` | `{ userId: 1, id: 1 }` | `unique: true` | No duplicate client-generated expense ids per account. |
| `expenses` | `{ userId: 1, expenseDate: 1 }` | -- | Per-user expense lookups and date-range queries. |
| `budgets` | `{ userId: 1, month: 1 }` | `unique: true` | One budget document per user per month. |
| `incomes` | `{ userId: 1, incomeDate: 1 }` | -- | Per-user income lookups and date-range queries. |
| `incomes` | `{ userId: 1, idempotencyKey: 1 }` | `unique: true`, `partialFilterExpression: { idempotencyKey: { $exists: true } }`, named `userId_1_idempotencyKey_1` | Durable retry-safe idempotency; partial so omitting the key never collides. |
| `mlfeedbacks` | *(none)* | -- | See gap 3.4. |
| `devicetokens` | `{ token: 1 }` | `unique: true` (field-level) | One registration per push token. |
| `merchantcategoryrules` | `{ userId: 1, merchantKey: 1 }` | `unique: true` | One rule per user per normalized merchant -- makes `upsertRule()` a true upsert. |
| `migrationledgers` | `{ migrationId: 1 }` | `unique: true` (field-level) | One ledger entry per migration, ever. |
| `notifications` | *(none)* | -- | See gap 3.3. |
| `pendingsyncs` | `{ user: 1 }` | `unique: true` (field-level `index: true` + `unique: true`) | One pending-sync marker per user. |
| `recurringexpenses` | `{ userId: 1, expenseId: 1 }` | `unique: true` | One recurring rule per (user, expense) pairing. |
| `recurringexpenses` | `{ nextDueDate: 1 }` | -- | Powers the due-date scan the recurring cron job runs. |
| `refreshsessions` | `{ userId: 1 }` | (field-level `index: true`) | Per-user session lookups. |
| `refreshsessions` | `{ tokenHash: 1 }` | `unique: true` (field-level) | One session per refresh-token hash. |
| `refreshsessions` | `{ expiresAt: 1 }` | `expireAfterSeconds: 0` (field-level TTL) | Session auto-expiry. |
| `refreshsessions` | `{ revokedAt: 1 }` | (field-level `index: true`) | |
| `refreshsessions` | `{ userId: 1, revokedAt: 1, expiresAt: 1 }` | -- | Compound -- powers "this user's currently-valid sessions" lookups without scanning revoked/expired rows. |
| `financialreports` | `{ user: 1 }` | `unique: true` (field-level) | One report cache document per user. See gap 3.1 for its `ref` mismatch (a separate issue from indexing). |
| `siamessages` | `{ session: 1, createdAt: 1 }` | -- | Ordered pagination of a session's messages / bounding LLM history. |
| `siamessages` | `{ session: 1, clientMessageId: 1 }` | `unique: true`, `sparse: true` | Idempotent message pairs; sparse so omitting the key never collides. |
| `siarequests` | `{ user: 1, clientMessageId: 1 }` | `unique: true` | Request-level idempotency key (user-scoped, not session-scoped -- protects a conversation's first turn too). |
| `siarequests` | `{ createdAt: 1 }` | `expireAfterSeconds: 86400` (24h TTL) | Bounded operational retention. |
| `siasessions` | `{ user: 1, updatedAt: -1 }` | -- | "List this user's sessions, most recently active first." |

25 index specs total across 16 collections (field-level `unique`/`index`/TTL
declarations counted individually, matching how `db.collection.indexes()`
would actually report them -- each is a real, separate index on the
server, not shorthand for the compound ones listed beside them).

## Verification

Every collection name in section 1 was verified by actually requiring
each model file in a real Node process and reading the resulting
`mongoose.model(<name>).collection.name` -- not inferred from Mongoose's
pluralization rules by eye. Command run (from `backend/`):

```js
require('./config/Schemas');
require('./models/DeviceToken');
require('./models/MerchantCategoryRule');
require('./models/MigrationLedger');
require('./models/Notification');
require('./models/PendingSync');
require('./models/RecurringExpense');
require('./models/RefreshSession');
require('./models/Report');
require('./models/SiaMessage');
require('./models/SiaRequest');
require('./models/SiaSession');
const mongoose = require('mongoose');
for (const name of mongoose.modelNames()) {
  console.log(name, '->', mongoose.model(name).collection.name);
}
```

This requires no live MongoDB connection -- `mongoose.model(...).collection`
resolves the collection name from the schema/model registration alone, so
it runs cleanly in this sandbox. Output matched section 1's table exactly,
including confirming the two mismatches (`budget` -> `budgets`, `mlFeedback`
-> `mlfeedbacks`) that `ADR-0002`/`backend/scripts/backup/collections.js`
had already found for the 7 authoritative collections, now extended to all
16.

The index table (section 4) and gap list (section 3) were built by reading
every schema file's source directly (`config/Schemas.js` in full,
every file under `backend/models/`) plus
`backend/migrations/scripts/20260903-ensure-core-indexes.js` and grepping
the whole `backend/` tree (excluding `node_modules`/`tests/`) for
`createIndex`, `ensureIndex`, `.index(`, `autoIndex` and `.populate(` to
confirm which indexes exist only via `autoIndex`, whether `autoIndex` is
ever overridden, and whether the `Report.js` `ref` mismatch (gap 3.1) is
live or latent. No code was changed as part of this task -- DAT-002-T01 is
inventory-only, matching the scope discipline already established by
DAT-001-T02 and FE-001-T01.
