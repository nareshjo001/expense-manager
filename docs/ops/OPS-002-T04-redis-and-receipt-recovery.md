# OPS-002-T04: Redis and receipt recovery expectations

This task documents what actually needs recovering, for the two things
OPS-002's spec calls out by name that are NOT covered by T03's encrypted
backups: Redis, and uploaded receipt images. Both conclusions below are
grounded in reading this repo's real code, not a general assumption.

## Redis: no backup/recovery procedure needed at all

[ADR-0002](../decisions/ADR-0002-authoritative-vs-disposable-stores.md)
(OPS-002-T01) already did the real analysis and states this plainly in
its own Consequences section: *"OPS-002-T04 (Redis/receipt recovery
expectations) can state plainly that Redis requires no backup/recovery
procedure at all -- every key it holds today is disposable by this
ADR."* This task confirms that conclusion still holds and spells out why,
concretely, per actual Redis usage in this codebase:

| Redis usage | File | What losing it costs |
|---|---|---|
| Expense cache | `backend/utils/expenseCache.js` | One cache-miss recomputation from `expenses` (the real, backed-up source of truth). TTL-bound (300s default), so it self-heals within minutes even with no code change. |
| Report cache | `backend/cache/reportCache.js` | Same -- `reportService.getReport()` already regenerates on a stale/missing cache entry. |
| Job lease/lock | `backend/utils/jobLease.js` | A lease that disappears just means the next scheduled run isn't blocked by a phantom lock. No data loss -- this is concurrency control, not storage. |

If the Redis instance backing this app is lost entirely (crash, host
replacement, accidental flush), the correct and complete recovery
procedure is: **point the app at a fresh, empty Redis instance and do
nothing else.** Every cache repopulates itself from MongoDB on the next
read; every lease/lock starts clean. There is no data in Redis today that
does not already exist, more durably, in one of the seven authoritative
MongoDB collections T03 backs up. This is why T03 scopes backups to
MongoDB only and does not attempt a Redis backup mechanism -- building
one would add real operational cost (a snapshot/restore path, a new
failure mode, a new thing to test in a drill) to protect data that was
never irreplaceable in the first place.

**If a future feature adds a Redis usage that is NOT a cache/lease** --
for example, if Redis ever became the primary store for something with
no MongoDB backing (a queue with no replay source, a counter with no
recomputation path) -- that usage must be classified in a follow-up to
[ADR-0002](../decisions/ADR-0002-authoritative-vs-disposable-stores.md)
before this conclusion can be assumed to still hold. Nothing today meets
that bar.

## Receipt images: nothing to recover -- they are never stored

This is the more interesting finding, because it's not what "receipt
recovery" usually means in a product like this. Tracing the real upload
path end to end (`backend/Controllers/BillControllers/billController.js`
-> `Services/BillServices/receiptSecurity.service.js` ->
`imageProcessor.js` -> `ocrService.js` -> `receiptParser.js`):

1. A receipt image arrives as `req.file.buffer` -- an in-memory buffer
   (multer, memory storage; confirmed no disk-storage config anywhere in
   `BillControllers/` or `BillServices/`).
2. It is validated, preprocessed (`sharp`, in-memory), OCR'd
   (`extractTextFromImage`), and parsed into structured fields
   (`parseReceipt`).
3. The parsed result is returned to the client in the HTTP response.
4. **The image buffer is never written to disk, never uploaded to
   object storage, and never persisted to MongoDB.** It exists only for
   the duration of that one request, then is garbage-collected. Grep
   confirms this: no `fs.writeFile`, no S3/Cloudinary/GCS client, no
   receipt-image field on `ExpenseModel` or any other schema, anywhere
   in `Services/BillServices/` or `Controllers/BillControllers/`.

The client-side app may choose to keep the original photo on the user's
own device (that's a frontend/mobile decision outside this backend's
scope), but as far as this backend and its data stores are concerned,
**a receipt image has nothing to back up, and nothing to restore.** What
*does* need to survive is the structured expense record the OCR pass
produced -- and that record, once the user saves it, lands in the
`expenses` collection, which is already one of T03's seven authoritative,
backed-up collections. Losing a receipt image after that point costs
nothing: the financial record it was used to create is what's protected.

**Recovery expectation to set with users/support, in plain language:**
if asked "can you recover my receipt photo," the honest answer is no --
this product was never built to store it past the moment it's OCR'd, and
that is a privacy-positive property (less sensitive image data at rest),
not a gap. What *is* recoverable, per T03/T05, is the expense entry the
receipt produced.

## What this task changes

Nothing code-wise -- like OPS-002-T01, this is pure analysis and
documentation. Its value is foreclosing a wrong assumption: a future
engineer (or this session's own subsequent tasks) reading OPS-002's
title, "Backup and recovery," could reasonably assume receipt images
need a backup mechanism and go build one. They don't, and the reasoning
above is why, traced against this specific codebase's actual code paths
rather than asserted from a generic best-practice.

## Sources

- `docs/decisions/ADR-0002-authoritative-vs-disposable-stores.md` (Redis
  classification, and the exact sentence this task confirms)
- `backend/utils/expenseCache.js`, `backend/cache/reportCache.js`,
  `backend/utils/jobLease.js` (Redis usage inventory)
- `backend/Controllers/BillControllers/billController.js`,
  `backend/Services/BillServices/receiptSecurity.service.js`,
  `backend/Services/BillServices/imageProcessor.js` (receipt upload path
  traced end to end, 2026-09-04)
