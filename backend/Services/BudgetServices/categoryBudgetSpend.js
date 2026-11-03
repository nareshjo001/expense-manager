"use strict";

// T01/I9 -- the one place per-category spent is computed.

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
