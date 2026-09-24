"use strict";

// IMP-001 -- CSV bulk-import row suggestions. Given a batch of
// mapped-but-not-yet-saved CSV rows for one user, suggests:
//   (a) which existing expense of theirs, if any, a row is a probable
//       duplicate of, reusing OCR-005's own signal
//       (utils/duplicateDetectionRules.js's buildDuplicateSignature /
//       isProbableDuplicateMatch) unmodified -- a CSV row has no file to
//       hash, so only the merchant+date+amount signal applies here, never
//       EXACT_FILE_MATCH.
//   (b) a category to fill in for a row the CSV itself left uncategorized,
//       from a merchant rule the user already saved via CAT-001
//       (models/MerchantCategoryRule.js), looked up by the exact same
//       merchantKey normalizer (utils/merchantNormalization.js) that
//       CategorizationServices/merchantRule.service.js writes those rules
//       with -- duplicateDetectionRules.js's own normalizeMerchantName is
//       a different, receipt-OCR-tuned normalizer and would not reliably
//       match the keys actually stored on MerchantCategoryRule documents.
//
// This runs inside another service's request path (CSV preview
// generation) and must never turn a suggestion failure into a request
// failure: every DB call and every per-row computation is wrapped so that
// any unexpected error degrades the WHOLE batch to
// {duplicateCandidateExpenseId: null, suggestedCategory: null} rather than
// throwing -- the same "a derived-data failure must never block the
// primary flow" posture Services/syncRecoveryService.js applies to
// budget/report recompute.

const { ExpenseModel } = require("../../config/Schemas");
const MerchantCategoryRule = require("../../models/MerchantCategoryRule");
const { normalizeMerchantKey } = require("../../utils/merchantNormalization");
const {
  buildDuplicateSignature,
  isProbableDuplicateMatch,
} = require("../../utils/duplicateDetectionRules");
const { logEvent } = require("../../utils/logger");

function emptyResult() {
  return { duplicateCandidateExpenseId: null, suggestedCategory: null };
}

// A row only gets suggestions once it already has every field a
// duplicate/category lookup actually needs. A row still missing any of
// these already failed required-field validation upstream -- nothing to
// match or key a category lookup with, so it's skipped entirely (no DB
// work attempted on its behalf).
function isEligibleRow(row) {
  return (
    row != null &&
    row.expenseName != null &&
    row.expenseAmount != null &&
    row.expenseDate != null
  );
}

// buildDuplicateSignature's own normalizeDateKey (utils/
// duplicateDetectionRules.js) is deliberately non-parsing: it only trims
// an ALREADY-canonical string, because OCR-005's one caller always hands
// it a string receiptParser.js produced in one consistent shape. This
// module has two different native date representations to reconcile
// instead -- a persisted expense's `expenseDate` is a real Mongoose Date
// (importCommitService.js writes it as `new Date(mapped.expenseDate)`),
// while a CSV row's `expenseDate` is the raw, unreformatted cell string
// importMappingService.js's mapAndValidateRow() stored verbatim. Neither
// side is "already canonical" on its own, so both are converted through
// this one helper to a plain UTC "YYYY-MM-DD" string -- using the same
// `new Date(...)` parse importCommitService.js itself already applies to
// a row's date string -- before ever reaching buildDuplicateSignature.
// This does not change or duplicate buildDuplicateSignature's own
// matching logic; it only supplies the string-shaped input its
// normalizeDateKey already expects.
function toCanonicalDateOnlyString(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Builds a buildDuplicateSignature-shaped signature for either an
// existing ExpenseModel document (lean) or a mapped CSV row -- both have
// the same field names (expenseName/expenseAmount/expenseDate), differing
// only in expenseDate's native type, which toCanonicalDateOnlyString
// above reconciles.
function buildSignatureFor(source) {
  return buildDuplicateSignature({
    expenseName: source.expenseName,
    expenseAmount: source.expenseAmount,
    expenseDate: toCanonicalDateOnlyString(source.expenseDate),
  });
}

// Indexes a user's existing expenses by "normalizedMerchant|normalizedDate"
// so a row is only ever compared against the (typically tiny) bucket of
// expenses sharing its own merchant+date -- not the user's whole expense
// history -- keeping this O(rows + expenses) rather than O(rows x
// expenses), which matters at up to 5000 imported rows. The index is only
// a candidate-narrowing step: isProbableDuplicateMatch (including its
// exact-amount check) is still the sole source of truth for whether two
// signatures actually match. Expenses whose own signature has a null
// merchant or date are skipped up front -- isProbableDuplicateMatch never
// matches a null field, so such an expense could never be a candidate for
// anything.
function indexExpensesBySignatureKey(expenses) {
  const index = new Map();
  for (const expense of expenses) {
    const signature = buildSignatureFor(expense);
    if (signature.normalizedMerchant == null || signature.normalizedDate == null) continue;
    const key = `${signature.normalizedMerchant}|${signature.normalizedDate}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ expense, signature });
  }
  return index;
}

// Tiebreak when more than one existing expense matches a row's signature:
// the most recently CREATED expense wins. expenseSchema uses
// `timestamps: true`, so every expense has an unambiguous createdAt;
// expenseDate alone is only a calendar day and can be shared by several
// genuinely different expenses, so it can't serve as the tiebreak itself.
// Falls back to comparing _id (Mongo ObjectIds are monotonically
// time-ordered) if createdAt is ever missing, so the pick is always
// deterministic rather than depending on array/query order.
function pickDuplicateCandidate(matches) {
  let best = null;
  for (const { expense } of matches) {
    if (!best) {
      best = expense;
      continue;
    }
    const bestTime = best.createdAt ? new Date(best.createdAt).getTime() : 0;
    const candidateTime = expense.createdAt ? new Date(expense.createdAt).getTime() : 0;
    if (candidateTime > bestTime) {
      best = expense;
    } else if (candidateTime === bestTime && String(expense._id) > String(best._id)) {
      best = expense;
    }
  }
  return best;
}

async function enrichRowsWithSuggestions({ userId, mappedRows }) {
  if (!Array.isArray(mappedRows) || mappedRows.length === 0) {
    return [];
  }

  const results = mappedRows.map(() => emptyResult());

  const eligibleIndexes = [];
  for (let i = 0; i < mappedRows.length; i++) {
    if (isEligibleRow(mappedRows[i])) eligibleIndexes.push(i);
  }
  if (eligibleIndexes.length === 0) {
    return results;
  }

  let expenses;
  let rules;
  try {
    [expenses, rules] = await Promise.all([
      ExpenseModel.find({ userId }).lean(),
      MerchantCategoryRule.find({ userId }).lean(),
    ]);
  } catch (err) {
    logEvent({
      level: "error",
      scope: "import-suggestion-service",
      event: "suggestion_batch_fetch_failed",
      errorMessage: (err && err.message) || String(err),
    });
    return results;
  }

  try {
    const expenseSignatureIndex = indexExpensesBySignatureKey(expenses || []);

    const ruleMap = new Map();
    for (const rule of rules || []) {
      if (rule && rule.merchantKey) ruleMap.set(rule.merchantKey, rule.category);
    }

    for (const i of eligibleIndexes) {
      const row = mappedRows[i];
      const result = results[i];

      const rowSignature = buildSignatureFor(row);
      if (rowSignature.normalizedMerchant != null && rowSignature.normalizedDate != null) {
        const key = `${rowSignature.normalizedMerchant}|${rowSignature.normalizedDate}`;
        const bucket = expenseSignatureIndex.get(key);
        if (bucket && bucket.length > 0) {
          const matches = bucket.filter(({ signature }) => isProbableDuplicateMatch(rowSignature, signature));
          if (matches.length > 0) {
            const candidate = pickDuplicateCandidate(matches);
            if (candidate) result.duplicateCandidateExpenseId = String(candidate._id);
          }
        }
      }

      // Only fill a gap the CSV itself left open -- a row that already
      // named its own category is never overridden by a rule.
      const rowCategory = typeof row.expenseCategory === "string" ? row.expenseCategory.trim() : row.expenseCategory;
      if (!rowCategory) {
        const merchantKey = normalizeMerchantKey(row.expenseName);
        if (merchantKey && ruleMap.has(merchantKey)) {
          result.suggestedCategory = ruleMap.get(merchantKey);
        }
      }
    }

    return results;
  } catch (err) {
    logEvent({
      level: "error",
      scope: "import-suggestion-service",
      event: "suggestion_batch_compute_failed",
      errorMessage: (err && err.message) || String(err),
    });
    return mappedRows.map(() => emptyResult());
  }
}

module.exports = { enrichRowsWithSuggestions };
