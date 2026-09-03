# BILLS-01 — Upload and extract a receipt

`POST /bills/bill-upload`

This endpoint validates and processes one receipt image to prefill the Add Expense form. It does not retain the upload, the OCR image, or extracted values.

## 1. Contract

| Item | Current behavior |
|---|---|
| Authentication | Required Bearer JWT; authentication runs before multipart parsing |
| Rate limits | General API limit plus 12 receipt attempts per authenticated user/IP per 15 minutes |
| Accepted files | One JPEG or PNG image only |
| File size | Maximum 5 MB |
| Stored files | None; upload and OCR processing stay in memory |
| Persistence | None; creating an expense remains a separate explicit action |

```http
POST /bills/bill-upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

bill=<JPEG or PNG image>
```

The only allowed multipart part is the `bill` file. Extra fields, wrong field names, multiple files, PDFs, and unsupported declared types are rejected before OCR.

## 2. Validation and processing flow

```text
Browser file
  -> client JPEG/PNG and 5 MB precheck
  -> authenticated API request
  -> per-user receipt rate limit
  -> memory-only multipart parser
  -> JPEG/PNG magic-byte verification
  -> declared MIME and detected signature agreement
  -> Sharp decoder metadata validation
  -> 10,000-pixel-side and 20,000,000-total-pixel limits
  -> resize/grayscale/normalize/sharpen in memory
  -> bounded Tesseract worker
  -> parsed receipt fields only
  -> editable Add Expense form
```

The decoder and preprocessor use Sharp's pixel limit. Animated or multi-page image inputs are rejected. PDF support is intentionally unavailable until a bounded renderer/OCR path is implemented.

## 3. OCR worker behavior

`extractTextFromImage` creates a Tesseract worker for one request, terminates it on success or failure, and applies `OCR_TIMEOUT_MS`.

| Setting | Default | Allowed range |
|---|---:|---:|
| `OCR_TIMEOUT_MS` | 30,000 ms | 1,000–120,000 ms |

An expired timeout terminates the worker, including one that completes startup after the request timed out. The API returns `504 OCR_PROCESSING_TIMEOUT`; other decoder/OCR failures return `422 OCR_PROCESSING_FAILED` without internal error detail.

## 4. Responses

Success:

```json
{
  "success": true,
  "message": "Receipt processed successfully.",
  "parsedReceipt": {
    "expenseName": "FRESH MART",
    "expenseAmount": 118,
    "expenseDate": "05/03/2026"
  }
}
```

The full OCR transcript is deliberately not returned. It was not consumed by the UI and can contain sensitive receipt data.

| Failure | Status | Stable code |
|---|---:|---|
| No file | 400 | `RECEIPT_FILE_REQUIRED` |
| Multipart shape invalid | 400 | `RECEIPT_UPLOAD_INVALID` |
| Unsupported declared type | 415 | `RECEIPT_UNSUPPORTED_FILE_TYPE` |
| Unknown signature | 415 | `RECEIPT_UNSUPPORTED_FILE` |
| Signature/MIME mismatch | 415 | `RECEIPT_MIME_MISMATCH` |
| Corrupt image | 422 | `RECEIPT_IMAGE_INVALID` |
| File or decoded image too large | 413 | `RECEIPT_FILE_TOO_LARGE` or `RECEIPT_IMAGE_TOO_LARGE` |
| OCR timeout | 504 | `OCR_PROCESSING_TIMEOUT` |
| OCR/decoder failure | 422 | `OCR_PROCESSING_FAILED` |
| Rate limited | 429 | `RECEIPT_RATE_LIMITED` |

## 5. Security and privacy

- Client MIME headers are a preliminary gate only; server-side signature and decoder checks decide whether a file is processed.
- The server never uses a client filename or writes a receipt to its filesystem.
- Structured `OCR-001` audit events contain only outcome, stable code, pseudonymized user identity, request ID, and timestamp. They exclude filenames, MIME values, receipt content, OCR text, and file size.
- Receipt parsing is non-persistent. The user must review and explicitly submit the subsequent expense form.

## 6. Frontend behavior

The picker limits selection to JPEG/PNG. It rejects unsupported files and files larger than 5 MB before upload, exposes the error through an accessible alert, sends an abort signal, and cancels an in-flight request when the screen unmounts. The returned fields remain editable in Add Expense.

## 7. Files involved

| Layer | File | Responsibility |
|---|---|---|
| Screen | `frontend/src/components/billScanner/BillUpload.js` | Client precheck, preview, cancellation, error state |
| Mutation | `frontend/src/hooks/mutations/useBillUploadMutation.js` | Forwards file and abort signal |
| Route | `backend/Routes/bill.routes.js` | Auth, receipt limit and multipart error contract |
| Upload middleware | `backend/Middlewares/upload.js` | In-memory JPEG/PNG parser with multipart limits |
| Security service | `backend/Services/BillServices/receiptSecurity.service.js` | Signature, decoder, resource and audit checks |
| Preprocessor | `backend/Services/BillServices/imageProcessor.js` | Bounded in-memory Sharp pipeline |
| OCR service | `backend/Services/BillServices/ocrService.js` | Time-bounded worker lifecycle |
| Controller | `backend/Controllers/BillControllers/billController.js` | Classified response contract |

## 8. Verified limits

The focused security suite covers a valid in-memory PNG, spoofed PNG bytes, MIME/signature mismatch, corrupt PNG data, PDF rejection, size rejection, extra multipart fields, OCR timeout, and worker cleanup. The frontend suite covers client-side rejection and cancellation.
