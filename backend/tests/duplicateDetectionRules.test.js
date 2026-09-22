// OCR-005-T01 -- unit tests for the contract every other OCR-005 module is
// built against. Pure functions, no mocks needed.
"use strict";

const {
  DUPLICATE_REASON_CODES,
  DUPLICATE_STATUSES,
  DUPLICATE_STATUS_VALUES,
  computeContentHash,
  normalizeMerchantName,
  normalizeDateKey,
  normalizeAmountCents,
  buildDuplicateSignature,
  isProbableDuplicateMatch,
} = require("../utils/duplicateDetectionRules");

describe("computeContentHash", () => {
  test("is deterministic for identical bytes", () => {
    const a = computeContentHash(Buffer.from("same bytes"));
    const b = computeContentHash(Buffer.from("same bytes"));
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  test("differs for different bytes -- a re-encoded image never hashes the same as the original", () => {
    const a = computeContentHash(Buffer.from("original bytes"));
    const b = computeContentHash(Buffer.from("re-encoded bytes"));
    expect(a).not.toBe(b);
  });

  test("rejects a non-Buffer input rather than silently hashing the wrong thing", () => {
    expect(() => computeContentHash("not a buffer")).toThrow(TypeError);
  });
});

describe("normalizeMerchantName", () => {
  test("collapses case, punctuation and spacing to a comparable key", () => {
    expect(normalizeMerchantName("Trader Joe's")).toBe("trader joe s");
    expect(normalizeMerchantName("TRADER JOE'S #412")).toBe("trader joe s 412");
  });

  test("returns null for non-string/empty input", () => {
    expect(normalizeMerchantName(undefined)).toBeNull();
    expect(normalizeMerchantName("")).toBeNull();
    expect(normalizeMerchantName(42)).toBeNull();
  });
});

describe("normalizeDateKey / normalizeAmountCents", () => {
  test("normalizeDateKey trims and guards non-strings", () => {
    expect(normalizeDateKey(" 2026-01-15 ")).toBe("2026-01-15");
    expect(normalizeDateKey(null)).toBeNull();
    expect(normalizeDateKey("")).toBeNull();
  });

  test("normalizeAmountCents converts to integer cents and guards non-finite input", () => {
    expect(normalizeAmountCents(125.5)).toBe(12550);
    expect(normalizeAmountCents(0)).toBe(0);
    expect(normalizeAmountCents(NaN)).toBeNull();
    expect(normalizeAmountCents(undefined)).toBeNull();
  });
});

describe("buildDuplicateSignature", () => {
  test("derives all three fields from a parsed receipt", () => {
    expect(
      buildDuplicateSignature({ expenseName: "Fresh Mart", expenseDate: "2026-01-15", expenseAmount: 125.5 })
    ).toEqual({ normalizedMerchant: "fresh mart", normalizedDate: "2026-01-15", amountCents: 12550 });
  });

  test("a field OCR could not read stays null rather than defaulting to something comparable", () => {
    expect(buildDuplicateSignature({})).toEqual({
      normalizedMerchant: null,
      normalizedDate: null,
      amountCents: null,
    });
  });
});

describe("isProbableDuplicateMatch", () => {
  const receiptA = { expenseName: "Fresh Mart", expenseDate: "2026-01-15", expenseAmount: 125.5 };

  test("matches when merchant, date and amount are all identical -- the re-encoded-image case", () => {
    const sigA = buildDuplicateSignature(receiptA);
    const sigB = buildDuplicateSignature({ ...receiptA });
    expect(isProbableDuplicateMatch(sigA, sigB)).toBe(true);
  });

  test("does NOT match a legitimate repeat purchase on a different date", () => {
    const sigA = buildDuplicateSignature(receiptA);
    const sigB = buildDuplicateSignature({ ...receiptA, expenseDate: "2026-01-22" });
    expect(isProbableDuplicateMatch(sigA, sigB)).toBe(false);
  });

  test("does NOT match a different merchant", () => {
    const sigA = buildDuplicateSignature(receiptA);
    const sigB = buildDuplicateSignature({ ...receiptA, expenseName: "Corner Cafe" });
    expect(isProbableDuplicateMatch(sigA, sigB)).toBe(false);
  });

  test("does NOT match a different amount", () => {
    const sigA = buildDuplicateSignature(receiptA);
    const sigB = buildDuplicateSignature({ ...receiptA, expenseAmount: 126.0 });
    expect(isProbableDuplicateMatch(sigA, sigB)).toBe(false);
  });

  test("never matches when either side is missing a field OCR couldn't read", () => {
    const sigA = buildDuplicateSignature(receiptA);
    const sigIncomplete = buildDuplicateSignature({ expenseName: "Fresh Mart", expenseDate: "2026-01-15" });
    expect(isProbableDuplicateMatch(sigA, sigIncomplete)).toBe(false);
    // Two receipts that both failed to read anything must not match each
    // other either -- two nulls are not a match.
    const sigEmptyA = buildDuplicateSignature({});
    const sigEmptyB = buildDuplicateSignature({});
    expect(isProbableDuplicateMatch(sigEmptyA, sigEmptyB)).toBe(false);
  });
});

describe("DUPLICATE_REASON_CODES / DUPLICATE_STATUSES", () => {
  test("reason codes and statuses are frozen and hold the exact expected values", () => {
    expect(Object.isFrozen(DUPLICATE_REASON_CODES)).toBe(true);
    expect(DUPLICATE_REASON_CODES).toEqual({
      EXACT_FILE_MATCH: "EXACT_FILE_MATCH",
      PROBABLE_MERCHANT_DATE_AMOUNT: "PROBABLE_MERCHANT_DATE_AMOUNT",
    });
    expect(Object.isFrozen(DUPLICATE_STATUSES)).toBe(true);
    expect(DUPLICATE_STATUS_VALUES).toEqual(["unreviewed", "confirmed_new", "linked_existing"]);
  });
});
