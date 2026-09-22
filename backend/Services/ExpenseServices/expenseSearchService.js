"use strict";

// EXP-002-T04 -- indexed query service for GET /expense/search. Extracted
// out of getbycustom.js (rather than left inline) both because the module
// breakdown names this its own unit and because the filter-building logic
// is non-trivial enough (4 optional predicates, category normalization,
// regex escaping) to warrant an independently-testable module, matching
// this codebase's existing separation (sia/financialQueryService.js,
// Services/RecurringServices/recurringStateService.js).
//
// See docs/expense/EXP-002-T03-T04-normalized-fields-and-query-service.md
// for the full reasoning: no new normalized/searchable field is added
// (EXP-002-T03) -- startDate/endDate are REQUIRED and now span-capped
// (EXP-002-T02), so every query here always uses the EXISTING
// { userId: 1, expenseDate: 1 } compound index as a range scan, and the
// four new optional filters are applied as additional predicates within
// that already-narrowed, single-user candidate set.

const { ExpenseModel } = require("../../config/Schemas");
const { normalizeCategoryForGrouping } = require("../../utils/categoryNormalization");
const { buildCursorFilter, paginateResults } = require("../../utils/pagination");

// Escapes every regex metacharacter so a user-supplied nameContains value
// can never be interpreted as anything but its own literal text -- no
// shared utils/escapeRegExp existed outside sia/financialQueryService.js's
// own private copy (confirmed by grep), and that file is SIA-controllers-
// only per its own header (the same reasoning EXP-002-T02 already applied
// to MAX_PERIOD_SPAN_DAYS), so this service gets its own rather than
// reaching across that boundary.
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Builds the Mongo filter for a single user's expense search. Every
// optional field EXP-002-T01 defined becomes one additional $and-combined
// predicate -- AND-only, per that contract (OR combinations are an
// explicit non-goal, not an oversight).
function buildExpenseSearchFilter(userId, { startDate, endDate, nameContains, category, minAmount, maxAmount, isRecurring } = {}) {
  const filter = {
    userId,
    expenseDate: { $gte: startDate, $lte: endDate },
  };

  if (nameContains !== undefined && nameContains !== null && nameContains !== "") {
    filter.expenseName = { $regex: escapeRegExp(nameContains), $options: "i" };
  }

  if (category !== undefined && category !== null && category !== "") {
    // expenseCategory is stored already-canonical (addexpense.js/
    // editExpense.js both normalize at write time) -- normalize the
    // incoming filter value the SAME way and exact-match, rather than a
    // substring/allowlist match. normalizeCategoryForGrouping is the
    // existing read-boundary wrapper (never throws, falls back to the
    // explicit "Uncategorized" bucket for unparseable input) -- the right
    // one to use here, not the write-boundary normalizeCategory.
    filter.expenseCategory = normalizeCategoryForGrouping(category);
  }

  if (minAmount !== undefined && minAmount !== null) {
    filter.expenseAmount = { ...(filter.expenseAmount || {}), $gte: minAmount };
  }
  if (maxAmount !== undefined && maxAmount !== null) {
    filter.expenseAmount = { ...(filter.expenseAmount || {}), $lte: maxAmount };
  }

  if (isRecurring !== undefined && isRecurring !== null) {
    filter.isRecurring = isRecurring;
  }

  return filter;
}

// Cursor-paginated search, mirroring getbycustom.js's own
// getByCustomPaginated exactly (same over-fetch-by-one-to-detect-hasMore
// shape, same sort order, same already-resolved limit/already-decoded
// cursor calling convention -- the controller resolves both via
// utils/pagination.js before calling in, exactly as it already does today)
// -- EXP-002-T01 already confirmed no pagination redesign is needed here,
// and this task does not revisit that.
async function searchExpenses(userId, params, limit, cursor) {
  const filter = {
    ...buildExpenseSearchFilter(userId, params),
    ...buildCursorFilter(cursor, "expenseDate"),
  };

  // Fetch one extra document beyond the page size to detect "more pages
  // remain" without a separate count query.
  const documents = await ExpenseModel.find(filter)
    .sort({ expenseDate: -1, _id: -1 })
    .limit(limit + 1)
    .lean();

  return paginateResults(documents, limit, "expenseDate");
}

module.exports = { buildExpenseSearchFilter, searchExpenses, escapeRegExp };
