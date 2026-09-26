"use strict";

// BUD-001-T03 -- PUT /api/category-budgets { month, category, amount }.
// Create-or-update keyed on (userId, month, category) (I12). userId comes
// only from the verified token; a body userId is never read (I13).
const { UserModel } = require("../../config/Schemas");
const { upsertCategoryBudget } = require("../../Services/BudgetServices/categoryBudget.service");
const { sendSuccess, sendRejection, sendUserMissing, sendServerError } = require("./respond");
const { summaryAfterWrite } = require("./summaryAfterWrite");

const upsertCategoryBudgetController = async (req, res) => {
  try {
    const user = await UserModel.findById(req.userId);
    if (!user) return sendUserMissing(res);

    const body = req.body || {};
    const now = new Date();
    const result = await upsertCategoryBudget(
      user._id,
      { month: body.month, category: body.category, amount: body.amount },
      { now }
    );
    if (!result.ok) return sendRejection(res, result);

    const summary = await summaryAfterWrite(user._id, result.budget.month, now);
    return sendSuccess(res, { budget: result.budget, summary });
  } catch (err) {
    return sendServerError(res, err);
  }
};

module.exports = { upsertCategoryBudget: upsertCategoryBudgetController };
