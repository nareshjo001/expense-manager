"use strict";

// CRUD and precedence service for user-scoped merchant category rules.
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
async function findRuleForMerchant(userId, rawMerchantName) {
  const merchantKey = normalizeMerchantKey(rawMerchantName);
  if (!merchantKey) return null;
  return MerchantCategoryRule.findOne({ userId, merchantKey }).lean();
}

// Creates or updates the single rule for this user+merchant.
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

// Deletes one rule. Ownership is enforced IN the query (userId is part of the filter, not checked after the fact) so a request for another use.
async function deleteRule(userId, ruleId) {
  const result = await MerchantCategoryRule.findOneAndDelete({ _id: ruleId, userId });
  return Boolean(result);
}

module.exports = { findRuleForMerchant, upsertRule, listRules, deleteRule, MerchantRuleValidationError };
