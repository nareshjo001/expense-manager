// CAT-001 -- backend/utils/merchantNormalization.js
"use strict";

const { normalizeMerchantKey, MAX_MERCHANT_KEY_LENGTH } = require("../utils/merchantNormalization");

describe("normalizeMerchantKey", () => {
  test("lowercases and collapses internal whitespace", () => {
    expect(normalizeMerchantKey("  Starbucks   Coffee  ")).toBe("starbucks coffee");
  });

  test("two differently-cased/whitespaced inputs for the same merchant converge on one key", () => {
    expect(normalizeMerchantKey("UBER EATS")).toBe(normalizeMerchantKey("Uber   Eats"));
  });

  test("returns null for non-string, empty and whitespace-only input", () => {
    expect(normalizeMerchantKey(undefined)).toBeNull();
    expect(normalizeMerchantKey(null)).toBeNull();
    expect(normalizeMerchantKey(123)).toBeNull();
    expect(normalizeMerchantKey("")).toBeNull();
    expect(normalizeMerchantKey("   ")).toBeNull();
  });

  test("rejects input longer than the maximum key length", () => {
    expect(normalizeMerchantKey("a".repeat(MAX_MERCHANT_KEY_LENGTH + 1))).toBeNull();
  });

  test("accepts input at exactly the maximum key length", () => {
    expect(normalizeMerchantKey("a".repeat(MAX_MERCHANT_KEY_LENGTH))).toBe("a".repeat(MAX_MERCHANT_KEY_LENGTH));
  });
});
