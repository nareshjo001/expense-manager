# Bills consumption map

What the Bills module actually contains, what it calls, and — equally important — which
layers it does not have. Traced from `backend/Routes/bill.routes.js` and
`frontend/src/components/billScanner/` outwards.

## A. Bills API inventory

| API ID | Method | Endpoint | Route mount | Backend handler | Frontend caller | Consumer | Status |
|---|---|---|---|---|---|---|---|
| [BILLS-01](bills-api-01-upload-and-extract.md) | POST | `/bills/bill-upload` | `app.use("/bills", apiLimiter, billRoutes)` | `uploadBill` | `uploadBill` in `billApi.js` | `BillUpload.js` → `AddExpense.js` | Actively used |

**That is the entire backend surface.** `bill.routes.js` declares one route. There is no
listing, viewing, editing, deleting, retry, preview, confirmation or save endpoint — those
operations do not exist rather than being undocumented.

| Operation | Endpoint? |
|---|---|
| Upload | Yes — BILLS-01 |
| Extraction | Yes — same request, no separate endpoint |
| Preview | No — client-side blob URL only |
| Confirmation | No — the Add Expense form is the confirmation surface |
| Saving | No Bills endpoint — persistence is `POST /expense/add-expense` |
| Listing / viewing | No — nothing is stored to list |
| Editing / deleting | No — no record exists |
| Retrying extraction | No — the user re-uploads the file |

## B. Frontend Bills inventory

| UI ID | Page/component | User action | Data source | Network request | State owner | Final result |
|---|---|---|---|---|---|---|
| B-1 | `AddExpense.js` — "Do you want to upload a bill?" | Click to open the scanner | — | none | `AddExpense` (`isBillUpload`) | Renders B-2 in place of the form |
| B-2 | `BillUpload.js` — file picker | Choose one image | Browser `File` | none | `BillUpload` (`selectedFile`) | Enables the upload button |
| B-3 | `BillUpload.js` — preview | Automatic on selection | `URL.createObjectURL` | none | `BillUpload` (`preview`) | `<img>` preview, revoked on change/unmount |
| B-4 | `BillUpload.js` — upload button | Click "Upload Bill" | BILLS-01 | `POST /bills/bill-upload` | `useBillUploadMutation` | Parsed values handed up by prop callback |
| B-5 | `AddExpense.js` — prefill effect | Automatic on `billData` | B-4's result | none | `AddExpense` (form fields) | Three of five fields filled |
| B-6 | `AddExpense.js` — form submit | Click submit | User-edited fields | `POST /expense/add-expense` | `useAddExpenseMutation` | Expense row in MongoDB |

**Six UI surfaces, two of which issue a network request.** There is no drag-and-drop, no
camera capture, no multi-file selection and no separate review screen — the ordinary Add
Expense form is the review surface.

| Property | Value |
|---|---|
| Accepted formats (UI) | `accept="image/*"` — PDF is never offered despite the server allowing it |
| File-size limit (UI) | **None.** Only the server enforces 5 MB |
| Client-side validation | **None** beyond `accept`; `handleUpload` only checks a file was chosen |
| Upload begins | On explicit button click, not on selection |
| FormData used | Yes — one field named `bill` |
| Multipart headers | Left unset deliberately so the browser writes the boundary |
| Duplicate-click protection | Button `disabled` while the mutation is pending |
| On unmount | Blob URL revoked; **the request is not cancelled** |

## C. File-processing and dependency inventory

| Stage | Implementation | File/function | Input | Output | Cleanup / failure behaviour |
|---|---|---|---|---|---|
| Browser file selection | Native input | `BillUpload.handleFileChange` | user click | `File` + blob URL | Blob URL revoked on replace and unmount |
| Client-side validation | **Absent** | — | — | — | Only `accept="image/*"` filters the picker |
| Multipart encoding | `FormData` | `billApi.uploadBill` | `File` | multipart body | — |
| Rate limiting | express-rate-limit | `apiLimiter` | request | pass / 429 | IP-keyed |
| Authentication | JWT middleware | `verifyToken` | header | `req.userId` / 401 | Runs **before** any file is written |
| Upload middleware | multer diskStorage | `Middlewares/upload.js` | multipart | temp file | 400 on bad MIME or >5 MB |
| Temp file | Local disk | `backend/billUploads/<ts>-<uuid>.<ext>` | stream | file on disk | `fs.unlink` in `finally` |
| Image preprocessing | sharp | `preprocessImage` | temp path | PNG in `billProcessed/` | `fs.unlink` in `finally`; throws → 500 |
| OCR | tesseract.js (local) | `extractTextFromImage` | PNG path | collapsed text | throws → 500; **no timeout** |
| External provider | **Absent** | — | — | — | No cloud OCR, AI or ML-service call exists |
| Response parsing | Regex | `parseReceipt` | text | 3 fields + transcript | Unmatched fields become `null` |
| Schema validation | **Absent** | — | — | — | Nothing validates the parsed values |
| Review and correction | React form | `AddExpense` | parsed fields | user-edited fields | Abandoning discards everything |
| Bill persistence | **Absent** | — | — | — | No Bill model exists |
| Expense persistence | Mongoose | `POST /expense/add-expense` | form fields | Expense row | Separate request; failure keeps the form |
| Cache invalidation | TanStack Query | `useAddExpenseMutation` | — | 4 families invalidated | Only after the expense save |
| UI update | React | `AddExpense` → navigate | — | expense list refreshed | — |

## D. Cross-module dependencies

| Bills touches | Nature | Documented in |
|---|---|---|
| `POST /expense/add-expense` | The persistence step after review. A separate request the user triggers. | [API-05](../expense/api-05-create-expense.md) · [BILLS-FLOW-01 §6](bills-flow-01-scan-to-expense.md) |
| `ExpenseModel` | Only indirectly, through that endpoint | [Expense set](../expense/README.md) |
| `queryKeys.expenses / budgets / reports / charts` | Invalidated by the expense save, not by Bills | [API-05 §12](../expense/api-05-create-expense.md#12-redis-and-frontend-cache-invalidation) |

Bills calls **no** Budget, Income, Charts, Report, Auth or ML endpoint. The ML
category-prediction call in `AddExpense` fires on user typing and is not part of the bill
path — a bill-supplied name is explicitly excluded from it by `programmaticNameRef`.

## E. Layers that do not exist

Stated explicitly because their absence is the module's defining characteristic:

- No Bill schema, model or collection
- No upload history, listing or retrieval
- No cloud or object storage — files live on local disk for the length of one request
- No external OCR, AI or document-analysis provider; no API key anywhere
- No ML-service dependency in the bill path
- No automatic expense creation
- No separate review or confirmation endpoint
- No Redis cache on the route
- No query-cache entry for bills
- No client-side size or content validation
- No timeout, retry or cancellation on the extraction request
