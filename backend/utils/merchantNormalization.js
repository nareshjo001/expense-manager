"use strict";

// CAT-001 -- normalizes a raw merchant/expense name into a stable lookup
// key for user-scoped category rules. Deliberately conservative (lowercase
// + collapsed whitespace only, the same shape as categoryNormalization.js's
// collapseWhitespace step) -- no stemming/fuzzy-matching, so a rule only
// ever matches merchant text a user has actually typed before, never a
// "close enough" guess that could silently misfile an unrelated expense.
const MAX_MERCHANT_KEY_LENGTH = 200;

// Returns the normalized key, or null when the input can't produce a valid
// one -- callers MUST treat null as "no usable merchant text", never fall
// back to an empty-string key (that would collide every blank/whitespace
// input into a single shared rule).
function normalizeMerchantKey(raw) {
  if (typeof raw !== "string") {
    return null;
  }
  const cleaned = raw.trim().replace(/\s+/g, " ").toLowerCase();
  if (!cleaned || cleaned.length > MAX_MERCHANT_KEY_LENGTH) {
    return null;
  }
  return cleaned;
}

module.exports = { normalizeMerchantKey, MAX_MERCHANT_KEY_LENGTH };
