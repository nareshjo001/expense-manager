"use strict";

// CAT-001 -- CRUD and precedence service for user-scoped merchant category
// rules. Every query is scoped by a verified `userId` (never a client-
// supplied one); a lookup miss returns null rather than throwing, since
// "no rule for this merchant" is the normal, expected case on every
// prediction.
const MerchantCategoryRule = require("../../models/MerchantCategoryRule");
const { normalizeMerchantKey } = require("../../utils/merchantNormalization");
const { normalizeCategory } = require("../../utils/categoryNormalization");

class MerchantRuleValidationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "MerchantRuleValidationError";
    this.statusCode = 400;
    this.code = code || "INVALID_MERCHANT_RULE";
  }
}

// Looks up a user's rule for a raw (unnormalized) merchant/expense name.
// Returns null for "no rule" AND for "the name doesn't normalize to a
// usable key" -- a lookup never throws, since predict-category calls this
// on every keystroke-driven request and a rule miss must never block the
// existing ML fallback path.
async function findRuleForMerchant(userId, rawMerchantName) {
  const merchantKey = normalizeMerchantKey(rawMerchantName);
  if (!merchantKey) return null;
  return MerchantCategoryRule.findOne({ userId, merchantKey }).lean();
}

// Creates or updates the single rule for this user+merchant. Upserts by the
// unique {userId, merchantKey} index, so saving a rule for an already-ruled
// merchant replaces its category rather than creating a duplicate.
async function upsertRule(userId, rawMerchantName, rawCategory) {
  const merchantKey = normalizeMerchantKey(rawMerchantName);
  if (!merchantKey) {
    throw new MerchantRuleValidationError("merchantName is required.", "INVALID_MERCHANT_NAME");
  }

  const category = normalizeCategory(rawCategory);
  if (!category) {
    throw new MerchantRuleValidationError("category is required and must be valid.", "INVALID_CATEGORY");
  }

  return MerchantCategoryRule.findOneAndUpdate(
    { userId, merchantKey },
    { $set: { category }, $setOnInsert: { userId, merchantKey } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
}

// Lists every rule for this user, most recently updated first.
async function listRules(userId) {
  return MerchantCategoryRule.find({ userId }).sort({ updatedAt: -1 }).lean();
}

// Deletes one rule. Ownership is enforced IN the query (userId is part of
// the filter, not checked after the fact) so a request for another user's
// ruleId matches nothing rather than ever touching their document.
async function deleteRule(userId, ruleId) {
  const result = await MerchantCategoryRule.findOneAndDelete({ _id: ruleId, userId });
  return Boolean(result);
}

module.exports = { findRuleForMerchant, upsertRule, listRules, deleteRule, MerchantRuleValidationError };
