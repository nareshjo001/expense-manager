# ADR-0002: Classify authoritative versus disposable stores (OPS-002-T01)

## Decision

Every persisted store in the application is classified into exactly one of
two tiers. This classification is the input OPS-002-T02 uses to set
RPO/RTO, and OPS-002-T03 uses to scope what encrypted backups actually
cover -- backing up a disposable store wastes retention budget and widens
the encrypted-backup blast radius for no recovery benefit.

### Authoritative (MongoDB) -- must be backed up; cannot be regenerated

| Collection (model) | Why it is authoritative |
|---|---|
| `users` (`UserModel`) | Account identity and credentials. No other source of truth. |
| `expenses` (`ExpenseModel`) | The core financial transaction history the whole product exists to track. Irreplaceable. |
| `incomes` (`IncomeModel`) | Core financial income history. Irreplaceable, same tier as expenses. |
| `budget` (`BudgetModel`) | User-set budget targets -- a business decision, not a derived value. |
| `RecurringExpense` | User-configured recurring-expense rules. A user's own configuration, not reconstructable from expense history alone. |
| `MerchantCategoryRule` | User-saved "this merchant always means this category" rules (CAT-001). User-authored, not re-derivable. |
| `mlFeedback` (`MlFeedbackModel`) | User-provided corrections used for model evaluation/retraining. Real signal that cannot be regenerated after the fact. |

**Correction (added by OPS-002-T03, 2026-09-04):** the "Collection (model)" column above lists mongoose *model-registration* names, not the real server-side MongoDB collection names `mongodump`/`mongorestore` operate on. Verified directly against this repo's `mongoose.model(...).collection.name`: `budget` -> `budgets`, `mlFeedback` -> `mlfeedbacks`, `RecurringExpense` -> `recurringexpenses`, `MerchantCategoryRule` -> `merchantcategoryrules` (mongoose's default pluralize+lowercase behavior, since none of these schemas override the collection name). `users`, `expenses`, and `incomes` are unaffected -- they already match. The table above is left as originally written rather than silently edited; `backend/scripts/backup/collections.js` is now the single place that resolves this list to real, verified collection names, and is what OPS-002-T03/T05/T07's tooling actually uses.

### Disposable / derived -- excluded from the backup guarantee

| Store | Why it is safe to exclude |
|---|---|
| `Report` (`financialReportSchema`, Mongo) | A per-user cache of the assembled report, already self-healing: `reportService.getReport()` regenerates it on a stale/missing contract version or revision (see `Services/reportService.js`). Losing it just costs one regeneration. |
| `PendingSync` | A durable-but-derived recovery marker. Its own doc comment states recovery is "a pure idempotent recomputation from `expenses`" -- it only records THAT something needs recomputing, never the financial data itself. |
| `RefreshSession` | Login session tokens with a Mongo TTL index (`expiresAt`, `expireAfterSeconds: 0`) -- already designed to expire on its own. Losing it logs users out; no financial data is at risk. |
| `SiaRequest` | Idempotency/dedup record for SIA's LLM calls (a question fingerprint plus the already-returned answer). Operational plumbing, not user data. |
| `DeviceToken` | Push-notification device registration. Reissued automatically the next time the device's app opens. |
| `Notification` | Historical log of past push notifications. Not financial data -- the underlying condition that triggered a notification (e.g. a budget threshold) is still derivable from `expenses`/`budget` even if the notification record itself is lost. |
| `SiaSession`, `SiaMessage` | The user's chat history with the SIA assistant. Valuable UX, but not financial data and not a source of truth for money -- explicitly out of the "financial history" scope OPS-002's problem statement names. |
| Redis (`utils/expenseCache.js`, `cache/reportCache.js`, `utils/jobLease.js`) | Every current Redis usage is a TTL-bound cache (default 300s) or a job lease/lock. This confirms, rather than changes, the assumption OPS-002's own spec already states: "Redis remains disposable/derived unless an ADR states otherwise." This ADR is that statement. |

## Context

OPS-002's problem statement is specifically about permanent loss of
**financial history** from a deployment, migration, or operator error.
Treating every collection as equally critical would either under-protect
the seven authoritative stores above, or over-scope encrypted backups (and
their associated retention/compliance surface) to cover session tokens and
notification logs that were never a data-loss risk to begin with.

The seven authoritative collections share one property none of the
disposable ones have: there is no code path that regenerates them from
something else already in the system. Every disposable store either has
an explicit regeneration path already in the codebase (`Report`,
`PendingSync`), a TTL/expiry mechanism already in place (`RefreshSession`,
all current Redis keys), or is operational/UX plumbing whose loss has no
financial consequence (`DeviceToken`, `Notification`, `SiaSession`,
`SiaMessage`, `SiaRequest`).

## Consequences

- OPS-002-T02 (RPO/RTO) only needs to set a recovery target for the seven
  authoritative MongoDB collections above.
- OPS-002-T03 (encrypted Mongo backups) can scope backup/restore tooling
  to those same seven collections rather than the whole database, unless
  a future ADR moves a store between tiers.
- OPS-002-T04 (Redis/receipt recovery expectations) can state plainly that
  Redis requires no backup/recovery procedure at all -- every key it holds
  today is disposable by this ADR.
- If a future feature adds a new collection, its author must classify it
  here (or in a follow-up ADR) rather than assume it is covered by
  whichever tier is more convenient.
- This ADR does not change any code, schema, or runtime behavior. It only
  fixes the classification that later OPS-002 tasks build on.
