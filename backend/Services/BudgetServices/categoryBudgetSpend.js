"use strict";

// BUD-001-T01/I9 -- the one place per-category spent is computed. Never
// persisted; used by both the summary (T03/T04) and the alert evaluation
// (T06) so they can never disagree about what "spent" means.

const mongoose = require("mongoose");
const { ExpenseModel } = require("../../config/Schemas");
const { normalizeCategoryForGrouping } = require("../../utils/categoryNormalization");
const { toMinorUnits } = require("../../utils/money");
const { monthToRange } = require("./categoryBudgetContract");

function toObjectId(userId) {
  if (userId instanceof mongoose.Types.ObjectId) return userId;
  return new mongoose.Types.ObjectId(String(userId));
}

// Returns { byCategory: Map<normalizedCategory, spentMinor>, totalSpentMinor }.
//
// Grouped by the RAW stored expenseCategory in MongoDB, then re-grouped in
// JS through normalizeCategoryForGrouping, so legacy documents written
// before CAT-001's write-time normalization (e.g. "food" next to "Food")
// still land in the same bucket, and invalid/missing categories land in the
// explicit "Uncategorized" bucket rather than being dropped. $match is on
// {userId, expenseDate}, served by the existing expense indexes.
async function aggregateSpentByCategory(userId, month) {
  const { monthStart, monthEnd } = monthToRange(month);

  const groups = await ExpenseModel.aggregate([
    {
      $match: {
        userId: toObjectId(userId),
        expenseDate: { $gte: monthStart, $lt: monthEnd },
      },
    },
    { $group: { _id: "$expenseCategory", total: { $sum: "$expenseAmount" } } },
  ]);

  const byCategory = new Map();
  let totalSpentMinor = 0;
  for (const group of groups) {
    const total = Number(group.total);
    if (!Number.isFinite(total)) continue;
    const minor = toMinorUnits(total);
    const category = normalizeCategoryForGrouping(group._id);
    byCategory.set(category, (byCategory.get(category) || 0) + minor);
    totalSpentMinor += minor;
  }

  return { byCategory, totalSpentMinor };
}

module.exports = { aggregateSpentByCategory, toObjectId };
