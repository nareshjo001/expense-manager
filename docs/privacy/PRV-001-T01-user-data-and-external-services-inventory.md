# PRV-001-T01: User-linked collections and external data inventory

Inventories every MongoDB collection that holds user-linked data and every
external service this codebase sends user data to, so PRV-001-T02 (define
immediate vs. delayed deletion policy) has a concrete, verified list to
scope a deletion policy against instead of discovering dependencies
mid-implementation. Builds directly on
[DAT-002-T01](../data/DAT-002-T01-schema-and-index-inventory.md)'s schema
inventory (same 16 models, same verified collection names) rather than
re-deriving it -- this document adds the ownership/ownership-absence angle
and the external-service surface DAT-002-T01 was not scoped to cover.

Method: every one of the 16 schema files DAT-002-T01 already catalogued
was re-read specifically for its ownership field; every external network
call site in `backend/` (`app.js`, `config/`, `Services/`,
`sia/`, `Middlewares/`) was located by grepping for the four external
integrations the feature doc's own "Evidence"/"External services" sections
name (Firebase, Brevo, Groq, Redis) plus a check for any file-upload
storage path; `ml-service/training/` and `ml-service/db/` were read
directly to confirm what does and does not reach disk keyed by user.

## 1. User-linked MongoDB collections (14 of 16)

Every collection from DAT-002-T01's 16-model inventory that carries an
explicit owner field, and what identifies the owner:

| Collection | Owner field | Type | Required |
|---|---|---|---|
| `users` | *(is the owner -- `_id`)* | -- | -- |
| `expenses` | `userId` | ObjectId, ref `users` | Yes |
| `incomes` | `userId` | ObjectId, ref `users` | Yes |
| `budgets` | `userId` | ObjectId, ref `users` | Yes |
| `mlfeedbacks` | `userId` | ObjectId, ref `users` | **No** -- see gap 4.1 |
| `devicetokens` | `userId` | ObjectId, ref `users` | Yes |
| `merchantcategoryrules` | `userId` | ObjectId, ref `users` | Yes |
| `notifications` | `userId` | ObjectId, ref `users` | Yes |
| `pendingsyncs` | `user` | ObjectId, ref `users`, one doc per user | Yes |
| `recurringexpenses` | `userId` | ObjectId, ref `users` | Yes |
| `refreshsessions` | `userId` | ObjectId, ref `users` | Yes |
| `financialreports` | `user` | ObjectId, `ref: "User"` (mismatched -- see DAT-002-T01 gap 3.1) | Yes |
| `siamessages` | `user` | ObjectId, ref `users` (denormalized onto every message) | Yes |
| `siarequests` | `user` | ObjectId, ref `users` | Yes |
| `siasessions` | `user` | ObjectId, ref `users` | Yes |

14 of 16 collections are user-owned. Two are not:

- `migrationledgers` -- operational metadata (which migrations have run),
  no owner field, correctly not user-scoped. Same collection DAT-002-T01
  gap 3.6 already flagged as unclassified in ADR-0002; noted again here
  only to confirm it is intentionally absent from this table, not an
  oversight.
- `users` itself -- it IS the owner, not owned by anything; deleting an
  account means deleting this document last (after every dependent
  collection above is handled), not listing it as a dependency of itself.

### 1.1 A dependent record can reference more than one user

Two collections have a foreign-key edge to something OTHER than the
account being deleted, which a deletion orchestration must be aware of
independently of the owner-field deletion above:

- `notifications.relatedId` -- an optional `ObjectId` ref to `expenses`.
  Deleting a user's expenses first (as `expenses.userId`-scoped) leaves
  any of that user's own notifications with a dangling `relatedId` unless
  the notification is also deleted -- not a cross-user reference, but an
  intra-account ordering dependency worth naming for T04's orchestration.
- `recurringexpenses.expenseId` -- required `ObjectId` ref to `expenses`,
  the most recently materialized occurrence. Same intra-account ordering
  concern: deleting `expenses` before `recurringExpenses` (rather than
  the reverse, or together) leaves a dangling reference.

No collection in this codebase references another user's data by
ObjectId -- every ref found (`expenses.userId`, `siamessages.session` ->
`SiaSession`, etc.) is either to `users` itself or to a document already
scoped to the same user. Confirmed by re-reading every `ref:` declaration
across all 16 schema files (the same set DAT-002-T01 already fully
enumerated).

## 2. External services that receive user-linked data

Located by reading every call site under `backend/Services/`, `backend/sia/`,
`backend/config/`, and `backend/Middlewares/` that talks to a service
outside this codebase's own MongoDB/Redis.

### 2.1 Firebase Cloud Messaging (push notifications)

`Services/push.service.js` sends a push message to every `DeviceToken`
document for a user (`DeviceToken.find({ userId })`), through Firebase
Admin SDK (`config/firebaseAdmin.js`). Firebase receives the device push
token and message content per send; it does not durably store anything
this app would need to reach back into on deletion -- the token itself is
already this app's own data (in `devicetokens`, deleted with the account),
and FCM sends are stateless per-call, not a data store. **No explicit
Firebase-side delete action is needed** beyond deleting the
`devicetokens` documents already covered in section 1.

### 2.2 Brevo (transactional email)

`Services/AuthServices/email.service.js` calls Brevo's
`TransactionalEmailsApi.sendTransacEmail()` for OTP verification and
(separately) operational alert emails. Confirmed by reading the file in
full: this codebase uses ONLY the transactional-send API -- no contact
list, no subscriber/audience feature, nothing that would create a durable
Brevo-side record keyed by the user's email beyond Brevo's own delivery
logs. **Open question, not resolved here:** Brevo's own retention policy
for transactional-send delivery logs (recipient address, subject,
timestamp) is outside this codebase's control and not documented anywhere
in this repo -- the same "external vendor, not approved/reviewed for a
specific data-handling guarantee" gap DAT-002's technical-design section
already names as a standing pattern for every external integration.

### 2.3 LLM providers -- OpenAI / Gemini / Groq (SIA chat)

`sia/llmService.js` sends the user's question plus a narrowed financial
context to whichever of OpenAI/Gemini/Groq is configured
(`ask.js` -> `askLlm()`). Read `sia/contextBuilder.js` directly to confirm
exactly what that context contains: it is built exclusively from
`reportService.getReport(userId)`, narrowed per-intent, and its own code
comments state the copied records are already "free of userId/raw expense
objects" before being handed to the LLM call -- i.e. **aggregated
financial figures (category totals, anomaly summaries, budget status
numbers) do leave this server to a third-party LLM provider on every SIA
chat turn, but the user's identity (no userId, no email, no name) and
individual transaction-level records do not.** Confirmed via
`SiaMessage.js`/`SiaRequest.js`'s own header comments (already read in
DAT-002-T01) that neither the raw prompt nor the provider's raw response
is itself persisted server-side afterward -- only the final answer text
and a bounded `grounding`/`planSummary` metadata shape are. **Open
question, not resolved here:** each provider's own prompt-retention
policy is undocumented in this repo -- same open-vendor-question pattern
as 2.2.

### 2.4 Groq (SIA voice transcription)

`sia/transcriptionService.js` sends raw audio bytes to Groq's
`/audio/transcriptions` endpoint (`GROQ_TRANSCRIPTIONS_URL`) for
speech-to-text. Confirmed via `Middlewares/audioUpload.js`: the upload
uses `multer.memoryStorage()`, so the audio buffer exists only for the
duration of the request and is never written to disk or Mongo on this
server -- the ONLY place the raw audio persists at all, even transiently,
is in transit to Groq. **Open question, not resolved here:** Groq's own
audio-retention policy for the transcription endpoint is undocumented in
this repo.

### 2.5 Receipt OCR -- NOT external

`Services/BillServices/receiptParser.js`'s OCR step runs against
Tesseract in-process (confirmed by the module's own "Tesseract's per-line
score is 0-100" comment) -- no external API call. `Middlewares/upload.js`
confirms receipt images also use `multer.memoryStorage()`: the image
buffer exists only for the duration of the request and is never written
to disk. **Receipt images never leave this server and are never
persisted anywhere** -- correctly out of scope for both external-service
notification and on-disk cleanup.

### 2.6 Redis (`utils/expenseCache.js`, `cache/reportCache.js`)

Already classified disposable/derived by
[ADR-0002](../decisions/ADR-0002-authoritative-vs-disposable-stores.md);
re-confirmed here specifically for user-scoping and, more usefully for
PRV-001-T04, that a reusable per-user clear function **already exists**
for both:

- `expenseCache.js` keys as `"<feature>:<userId>[:<variant>]"` and already
  exports `clearUserExpenseCache(userId)`.
- `reportCache.js` keys as `` `report:${userId}` `` and already exports
  `invalidate(userId, revision)`.

Both are TTL-bound (default 300s per the module comments already quoted
in ADR-0002) so a user's cache entries self-expire even without an
explicit clear call, but the functions above mean PRV-001-T05/T06 ("revoke
sessions/tokens and stop jobs first" / "propagate deletion...") can reuse
existing abstractions rather than write new Redis-clearing code -- exactly
the kind of reuse this project's engineering standards ask for.

`utils/jobLease.js` keys as `"<prefix><jobName>"` -- not user-scoped, no
user data, correctly out of scope.

### 2.7 ml-service training artifacts -- confirmed NOT user-identifiable on disk

`ml-service/db/feedback_repository.py` reads full `mlfeedbacks` documents
from Mongo (including `userId`) into memory during training-run export,
but `ml-service/training/dataset_builder.py`'s own header comment states
explicitly: "Exact columns trainer.py expects; no MongoDB ids, statuses,
or other lifecycle fields written into trainer input" -- confirmed by
reading its CSV-writing code, which writes only `[name, category]` per
row. Checked the actual on-disk artifact this produces
(`training/dataset/merged_expenses.csv`): header is
`expenseName,expenseCategory` only. **No on-disk ml-service artifact
contains a userId or any other user-identifying field** -- deleting a
user's `mlfeedbacks` Mongo documents (a policy decision for T02, not
decided here) is sufficient; no ml-service file cleanup is implied by
this inventory.

### 2.8 Encrypted MongoDB backups (OPS-002) -- an already-documented, unresolved limitation

Not a new finding -- flagging it here because PRV-001's own proposed
outcome explicitly calls for "documented backup/model limitations," and
this codebase already has the documentation: `docs/decisions/ADR-0005-
backup-rpo-rto.md` records an approved, provisional **35 rolling daily
backups** retention floor for the 7 ADR-0002-authoritative collections
(`users`, `expenses`, `incomes`, `budget`, `RecurringExpense`,
`MerchantCategoryRule`, `mlFeedback`) -- 5 of which (`users`, `expenses`,
`incomes`, `RecurringExpense`, `mlFeedback`) directly overlap this
inventory's user-linked collections in section 1. ADR-0005 already states
plainly that this retention window is "today... a floor (keep at least 5
weeks) with no corresponding ceiling (delete after N days) analysis," and
that the open compliance-jurisdiction question (also still UNKNOWN) could
force a real ceiling. **Concrete consequence for PRV-001:** a deleted
user's data in those 5 overlapping collections will still exist in
encrypted backup snapshots for up to ~35 days after deletion, regardless
of what PRV-001-T02 through T07 build. This is a pre-existing,
already-approved constraint (ADR-0005, accepted 2026-09-10) that
PRV-001-T02's deletion policy needs to state as a documented limitation
to the user, not attempt to solve by rewriting backup retention.

## 3. Cross-reference: ADR-0002 tier vs. this inventory's user-linked set

| ADR-0002 tier | Collections | Overlaps this inventory's 14 user-linked collections |
|---|---|---|
| Authoritative (7) | `users`, `expenses`, `incomes`, `budget`, `RecurringExpense`, `MerchantCategoryRule`, `mlFeedback` | All 7 |
| Disposable/derived (8) | `Report`, `PendingSync`, `RefreshSession`, `SiaRequest`, `DeviceToken`, `Notification`, `SiaSession`, `SiaMessage` | All 8 (every disposable store in ADR-0002 is ALSO individually user-scoped -- "disposable" describes recoverability, not whether it is user data) |
| Unclassified (1) | `MigrationLedger` | 0 (not user-scoped -- see section 1) |

This confirms: every disposable/derived collection in ADR-0002 is still a
real user-linked collection for deletion purposes (it is disposable in
the sense that losing it to a *crash* costs little, not in the sense that
it is exempt from a user's deletion request). PRV-001-T02's "immediate
vs. delayed" policy question is therefore orthogonal to ADR-0002's
authoritative/disposable axis -- both tiers need a deletion answer, just
possibly a different one (e.g. authoritative collections might warrant a
grace/cancel window per the feature's proposed outcome, while a TTL-bound
Redis cache entry does not need one at all since it already self-expires
within minutes).

## 4. Known gaps (documented, not resolved -- in scope for PRV-001-T02+)

### 4.1 `MlFeedbackSchema.userId` is the only owner field in this inventory that is not `required`

Noted in section 1's table. Confirmed by re-reading `config/Schemas.js`
directly (same read DAT-002-T01 already did): every other owner field in
this inventory (`userId`/`user`, 13 other collections) is `required:
true`; `MlFeedbackSchema.userId` has no `required` option at all, meaning
an `mlfeedbacks` document can theoretically exist with no owner. Whether
any pre-existing document actually has a null `userId` was not checked
here (would need a live Mongo query, unavailable in this sandbox per the
same `pymongo`/OpenSSL environment limitation DAT-002-T01's session
encountered) -- flagged as a real question PRV-001-T02's deletion-scope
definition needs an answer to (does "delete every mlfeedbacks document
where userId matches" miss orphaned documents with no userId at all?),
not assumed either way.

### 4.2 Three external services (Brevo, three LLM providers, Groq transcription) have undocumented data-retention policies

Sections 2.2, 2.3, 2.4. This codebase has no record of any of these
vendors' own retention/deletion guarantees for the data this app sends
them (email addresses to Brevo; aggregated financial figures and
questions to the LLM providers; raw audio to Groq's transcription
endpoint). This is the same "external vendors are UNKNOWN/not approved"
gap DAT-002's technical-design section already names as a standing
pattern for external integrations generally -- PRV-001-T02 needs to
either treat these as an accepted, documented limitation (the same
treatment ADR-0005 already gave backup retention) or open a follow-up
task to actually contact/review each vendor's policy. Not resolved here;
this task is inventory-only.

### 4.3 Encrypted backup retention (section 2.8) already documents a real post-deletion data-persistence window

Not a new gap -- restated here because it is the single most concrete,
already-quantified limitation ("~35 days") this inventory found, and
PRV-001-T02's policy definition should cite it directly rather than
independently rediscover or re-estimate it.

## Verification

Section 1's collection/owner-field table was produced by re-reading all
16 schema files directly (the identical set DAT-002-T01 already fully
transcribed field-by-field) specifically for their `ref`/ownership
declarations -- no new file was skipped, and no ownership claim here was
inferred from a collection's name or purpose. Section 2's external-service
list was produced by grepping the whole `backend/` tree (excluding
`node_modules`/`tests/`) for `firebase`, `brevo`/`Brevo`, `groq`/`Groq`,
and `redis`/`Redis` (the four the feature doc's own "External services"
technical-design bullet already names), then reading every matched file
directly rather than assuming behavior from the filename -- this is what
surfaced that receipt OCR is local/Tesseract (not external, despite being
adjacent code to the genuinely-external transcription path) and that both
receipt images and SIA audio use `multer.memoryStorage()` (never touch
disk). The ml-service on-disk artifact claim (2.7) was verified by reading
`dataset_builder.py`'s CSV-writing code directly and then reading the
actual header row of the real `training/dataset/merged_expenses.csv` file
this pipeline produces, rather than trusting the code comment alone. No
code was changed as part of this task.
