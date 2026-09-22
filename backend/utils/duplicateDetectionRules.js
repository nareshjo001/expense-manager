"use strict";

const crypto = require("crypto");

// OCR-005-T01 -- the fixed duplicate-detection contract every OCR-005
// module (the schema fields on Receipt.js, the candidate service, the
// frontend banner, and this task's own tests) is built against, the same
// "write the contract by hand before any parallel work starts" approach
// OCR-004-T01's utils/receiptLifecycle.js already used.
//
// Two independent signals, on purpose -- neither one alone is enough:
//   - EXACT_FILE_MATCH: the user uploaded the identical bytes again (a
//     photo re-uploaded, an accidental double-tap on "upload"). Detected
//     by content hash, so it survives a filename change but NOT a
//     re-encode/re-compress (a different byte stream for the same visual
//     receipt) -- that case is exactly what the second signal below is
//     for.
//   - PROBABLE_MERCHANT_DATE_AMOUNT: OCR extracted the same merchant name,
//     the same date, and the same amount as an existing receipt. This is
//     what catches a re-encoded/re-cropped duplicate of the same physical
//     receipt (different bytes, same extracted content), at the cost of
//     also catching a genuine, legitimate repeat purchase (same coffee
//     shop, same $4.50, different actual day that OCR happened to
//     misread as the same date -- rare, but why this is "probable", not
//     "certain", and why OCR-005-T05's UI always asks for confirmation
//     rather than silently blocking the upload).
//
// Both signals are USER-SCOPED (see Receipt.js's new indexes) -- one
// user's receipt is never compared against another user's, both for
// privacy and because "duplicate" only means anything within one
// person's own expense history.

const DUPLICATE_REASON_CODES = Object.freeze({
  EXACT_FILE_MATCH: "EXACT_FILE_MATCH",
  PROBABLE_MERCHANT_DATE_AMOUNT: "PROBABLE_MERCHANT_DATE_AMOUNT",
});

const DUPLICATE_REASON_CODE_VALUES = Object.freeze(Object.values(DUPLICATE_REASON_CODES));

// The three legal values of Receipt.duplicateStatus -- mirrors
// receiptLifecycle.js's RECEIPT_REVIEW_STATUSES shape (a small frozen
// enum object plus its values array) for the same reason: a duplicate
// decision needs to record which of two REAL choices the user made, not
// just "seen"/"not seen".
const DUPLICATE_STATUSES = Object.freeze({
  UNREVIEWED: "unreviewed",
  CONFIRMED_NEW: "confirmed_new",
  LINKED_EXISTING: "linked_existing",
});

const DUPLICATE_STATUS_VALUES = Object.freeze(Object.values(DUPLICATE_STATUSES));

// A receipt is only ever a "probable" candidate against another receipt
// whose extracted amount is within this many cents of its own. 0 by
// design, not a fuzzy tolerance band: OCR-003's parseReceipt() already
// returns a single best-guess numeric amount (not a range), so two
// genuinely-identical receipts parse to the identical number far more
// often than they parse to two numbers a few cents apart by chance --
// widening this tolerance would mostly just catch unrelated purchases
// that happen to cost close to the same amount. If real usage data ever
// shows OCR amount-rounding drift between two scans of literally the same
// receipt, this is the one constant to revisit -- not the matching logic
// around it.
const AMOUNT_MATCH_TOLERANCE_CENTS = 0;

// sha256 of the raw uploaded bytes -- the same content-addressing
// approach a git blob or a CDN cache key uses. Deliberately hashes
// file.buffer (the ORIGINAL validated upload receiptIngestService.js
// persists to GridFS), never the preprocessed image OCR reads, so the
// hash means "the same file the user picked", not "the same thing
// Tesseract happened to see".
function computeContentHash(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError("computeContentHash: buffer must be a Buffer.");
  }
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// Collapses OCR-varying whitespace/case/punctuation so "Trader Joe's",
// "TRADER JOE'S #412" and "trader joes" land on a comparable key. Not a
// fuzzy/edit-distance match on purpose -- see the module comment above on
// why this signal is already probabilistic enough without also guessing
// at near-miss spellings.
function normalizeMerchantName(name) {
  if (typeof name !== "string") return null;
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return normalized || null;
}

// parseReceipt()'s expenseDate is already a plain string (see
// receiptParser.js); this just guards against a non-string/empty value
// rather than re-parsing it, so a receipt with no readable date never
// silently matches every other dateless receipt (both would normalize to
// null, and null is never treated as a match -- see
// isProbableDuplicateMatch below).
function normalizeDateKey(dateValue) {
  if (typeof dateValue !== "string") return null;
  const trimmed = dateValue.trim();
  return trimmed || null;
}

// parseReceipt()'s expenseAmount is a plain number (or absent). Stored as
// integer cents so the candidate-lookup index (OCR-005-T03) compares
// exact integers, never floating-point dollars.
function normalizeAmountCents(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

// The one function every write path (receiptIngestService.js today, and
// any future re-parse/correction path) calls to derive the three
// candidate-index fields from an already-parsed receipt -- so
// "normalizedMerchant/normalizedDate/amountCents" is computed exactly
// once, in exactly one place, never re-derived ad hoc by a query site.
function buildDuplicateSignature(parsedReceipt) {
  return {
    normalizedMerchant: normalizeMerchantName(parsedReceipt && parsedReceipt.expenseName),
    normalizedDate: normalizeDateKey(parsedReceipt && parsedReceipt.expenseDate),
    amountCents: normalizeAmountCents(parsedReceipt && parsedReceipt.expenseAmount),
  };
}

// True only when EVERY field of the signature is present (non-null) on
// both sides and they all match -- a receipt with a missing/unreadable
// merchant, date or amount can never be a "probable" match for anything,
// since a null-to-null comparison would otherwise flag every low-
// confidence OCR scan as a duplicate of every other one.
function isProbableDuplicateMatch(signatureA, signatureB) {
  if (!signatureA || !signatureB) return false;
  const { normalizedMerchant: ma, normalizedDate: da, amountCents: aa } = signatureA;
  const { normalizedMerchant: mb, normalizedDate: db, amountCents: ab } = signatureB;
  if (ma === null || ma === undefined) return false;
  if (da === null || da === undefined) return false;
  if (aa === null || aa === undefined) return false;
  if (mb === null || mb === undefined) return false;
  if (db === null || db === undefined) return false;
  if (ab === null || ab === undefined) return false;
  if (ma !== mb) return false;
  if (da !== db) return false;
  return Math.abs(aa - ab) <= AMOUNT_MATCH_TOLERANCE_CENTS;
}

module.exports = {
  DUPLICATE_REASON_CODES,
  DUPLICATE_REASON_CODE_VALUES,
  DUPLICATE_STATUSES,
  DUPLICATE_STATUS_VALUES,
  AMOUNT_MATCH_TOLERANCE_CENTS,
  computeContentHash,
  normalizeMerchantName,
  normalizeDateKey,
  normalizeAmountCents,
  buildDuplicateSignature,
  isProbableDuplicateMatch,
};
