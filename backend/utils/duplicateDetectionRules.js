"use strict";

const crypto = require("crypto");

// Js already used. Two independent signals, on purpose -- neither one alone is enough: - EXACT_FILE_MATCH: the user uploaded the identical byt.

const DUPLICATE_REASON_CODES = Object.freeze({
  EXACT_FILE_MATCH: "EXACT_FILE_MATCH",
  PROBABLE_MERCHANT_DATE_AMOUNT: "PROBABLE_MERCHANT_DATE_AMOUNT",
});

const DUPLICATE_REASON_CODE_VALUES = Object.freeze(Object.values(DUPLICATE_REASON_CODES));

// Js's RECEIPT_REVIEW_STATUSES shape (a small frozen enum object plus its values array) for the same reason: a duplicate decision needs to record which of two REAL choices the user made, not just "seen"/"not seen".
const DUPLICATE_STATUSES = Object.freeze({
  UNREVIEWED: "unreviewed",
  CONFIRMED_NEW: "confirmed_new",
  LINKED_EXISTING: "linked_existing",
});

const DUPLICATE_STATUS_VALUES = Object.freeze(Object.values(DUPLICATE_STATUSES));

// A receipt is only ever a "probable" candidate against another receipt whose extracted amount is within this many cents of its own.
const AMOUNT_MATCH_TOLERANCE_CENTS = 0;

// Sha256 of the raw uploaded bytes -- the same content-addressing approach a git blob or a CDN cache key uses.
function computeContentHash(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError("computeContentHash: buffer must be a Buffer.");
  }
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// Collapses OCR-varying whitespace/case/punctuation so "Trader Joe's", "TRADER JOE'S #412" and "trader joes" land on a comparable key.
function normalizeMerchantName(name) {
  if (typeof name !== "string") return null;
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return normalized || null;
}

// Js); this just guards against a non-string/empty value rather than re-parsing it, so a receipt with no readable date never silently matches every other dateless receipt (both would normalize to null, and null is never treated as a match -- see isProbableDuplicateMatch below).
function normalizeDateKey(dateValue) {
  if (typeof dateValue !== "string") return null;
  const trimmed = dateValue.trim();
  return trimmed || null;
}

// ParseReceipt()'s expenseAmount is a plain number (or absent).
function normalizeAmountCents(amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

// Js today, and any future re-parse/correction path) calls to derive the three candidate-index fields from an already-parsed receipt -- so "normalizedMerchant/normalizedDate/amountCents" is computed exactly once, in exactly one place, never re-derived ad hoc by a query site.
function buildDuplicateSignature(parsedReceipt) {
  return {
    normalizedMerchant: normalizeMerchantName(parsedReceipt && parsedReceipt.expenseName),
    normalizedDate: normalizeDateKey(parsedReceipt && parsedReceipt.expenseDate),
    amountCents: normalizeAmountCents(parsedReceipt && parsedReceipt.expenseAmount),
  };
}

// True only when EVERY field of the signature is present (non-null) on both sides and they all match -- a receipt with a missing/unreadable merchant, date or amount can never be a "probable" match for anything, since a null-to-null comparison would otherwise flag every low- confidence OCR scan as a duplicate of every other one.
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
