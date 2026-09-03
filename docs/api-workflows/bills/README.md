# Bills module — API workflow documentation

One endpoint, one combined workflow. Everything was discovered by reading
`backend/Routes/bill.routes.js` and `frontend/src/components/billScanner/` outwards;
nothing was assumed from the module's name.

Diagrams reuse the approved BALENISA design system in
[`../diagram-tokens.json`](../diagram-tokens.json) and
[`../workflow_diagram.py`](../workflow_diagram.py). **No shared code was modified or
extended for Bills** — the existing card, note-box, pill-group and exception-band
components covered every stage.

## What this module is — and is not

The name suggests more than the code contains. Confirmed by inspection:

| | |
|---|---|
| **Is** | A single upload endpoint that OCRs a receipt image and returns three guessed values |
| **Is not** | A bill store. There is no Bill schema, no record, no history, no retained file |
| **OCR** | `tesseract.js`, running **in-process**. No cloud OCR, no AI provider, no API key |
| **ML service** | Not involved in the bill path at all |
| **Persistence** | None by this module. The final record is an **Expense**, saved by a separate request the user triggers |
| **Storage** | Two temp files on local disk, both `unlink`ed in a `finally` block before responding |

## A. Bills API inventory

| API ID | Method | Endpoint | Route mount | Backend handler | Frontend caller | Consumer | Status |
|---|---|---|---|---|---|---|---|
| [BILLS-01](upload-extract/bills-api-01-upload-and-extract.md) | POST | `/bills/bill-upload` | `app.use("/bills", apiLimiter, billRoutes)` | `uploadBill` | `uploadBill` (`billApi.js`) | `BillUpload.js` → `AddExpense.js` | Actively used |

No backend-only routes. No frontend call pointing at a missing endpoint. No duplicate,
legacy or unreachable route. Upload, extraction, preview, confirmation, saving, listing,
viewing, editing, deleting and retry are covered in
the consumption map — only the first two
exist, and they share one request.

## B. Frontend Bills inventory

Six UI surfaces, two of which issue a network request. Full table with formats, validation,
state ownership and unmount behaviour in
bills-consumption-map.md.

## C. File-processing and dependency inventory

Every stage from file picker to UI update, including the ones that are **absent**
(client-side validation, external provider, schema validation, bill persistence), is
tabulated in
bills-consumption-map.md.

## Documents

| # | Workflow | Classification | Level 1 | Level 2 | Document |
|---|---|---|---|---|---|
| BILLS-01 | Upload and extract | Upload → extraction only | [svg](upload-extract/bills-api-01-upload-and-extract-overview.svg) | [svg](upload-extract/bills-api-01-upload-and-extract-detailed.svg) | [md](upload-extract/bills-api-01-upload-and-extract.md) |
| FLOW-01 | Scan to saved expense | Upload → extraction → review → **explicit** persistence (combined Bills–Expense) | [svg](flow/bills-flow-01-scan-to-expense-overview.svg) | [svg](flow/bills-flow-01-scan-to-expense-detailed.svg) | [md](flow/bills-flow-01-scan-to-expense.md) |

Plus the consumption map.

## Structural facts

| | Value |
|---|---|
| Route mount | `app.use("/bills", apiLimiter, billRoutes)` |
| Middleware order | `apiLimiter` → `verifyToken` → multer → controller |
| Auth before file write | **Yes** — `verifyToken` precedes multer |
| Multipart field | `bill`, single file |
| Accepted MIME | `image/jpeg`, `image/png` |
| Size limit | 5 MB, enforced in the frontend and server-side, reported as `413` |
| Filename | Never persisted; processing remains in memory |
| Redis | None |
| Query cache | None — the result is passed by prop callback |
| Invalidation | None on this route, correctly — it changes no server state |

## Findings roll-up

Full findings with consequences live in the two workflow documents. The six worth reading
first — the first three verified by running the parser:

1. **A subtotal can be reported as the total.** The regex matches "total" inside
   "Subtotal"; when no grand total exists the *last* match wins, so
   `Total 118.00 … Subtotal 100` returns **100**.
2. **Malformed amounts parse silently.** `12.34.56` yields **12.34** with no error and no
   sanity check.
3. **The merchant name is the first two words of the transcript.** A receipt beginning
   `*** WELCOME TO FRESH MART` gives `"*** WELCOME"`.
4. **Successfully extracted dates are dropped.** `formatDateForInput` handles only
   `DD/MM/YYYY`; a written month name that the parser *did* match becomes `""`, and a
   two-digit year yields an invalid string.
5. **PDF support is intentionally unavailable.** Direct callers receive `415` before a PDF
   reaches a decoder, avoiding unbounded multi-page rendering until a separately reviewed,
   resource-bounded renderer is introduced.
6. **OCR confidence is discarded**, so a barely-legible scan is presented exactly like a
   perfect one.

Positives worth recording: authentication runs **before** any file is written; the client
filename is never used, so there is no path-traversal surface; and cleanup runs in a
`finally` block on both the success and failure paths.

## Regenerating

```bash
cd docs/api-workflows/bills
python3 build_bills_overviews.py
python3 build_bills_detailed.py
```

Both scripts resolve the shared engine with `sys.path.insert(0, os.path.dirname(HERE))`
and write outputs with `os.path.join(HERE, …)`, so they work from any working directory.
