"use strict";

// Indexed query service for GET /expense/search. js).

const { ExpenseModel } = require("../../config/Schemas");
const { normalizeCategoryForGrouping } = require("../../utils/categoryNormalization");
const { buildCursorFilter, paginateResults } = require("../../utils/pagination");

// Js's own private copy (confirmed by grep), and that file is SIA-controllers- only per its own header (the same reasoning EXP-002-T02 already applied to MAX_PERIOD_SPAN_DAYS), so this service gets its own rather than reaching across that boundary.
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Builds the Mongo filter for a single user's expense search.
function buildExpenseSearchFilter(userId, { startDate, endDate, nameContains, category, minAmount, maxAmount, isRecurring } = {}) {
  const filter = {
    userId,
    expenseDate: { $gte: startDate, $lte: endDate },
  };

  if (nameContains !== undefined && nameContains !== null && nameContains !== "") {
    filter.expenseName = { $regex: escapeRegExp(nameContains), $options: "i" };
  }

  if (category !== undefined && category !== null && category !== "") {
    // Js both normalize at write time) -- normalize the incoming filter value the SAME way and exact-match, rather than a substring/allowlist match.
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

// Js before calling in, exactly as it already does today) -- EXP-002-T01 already confirmed no pagination redesign is needed here, and this task does not revisit that.
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
