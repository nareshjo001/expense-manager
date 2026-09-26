"use strict";

// BUD-001-T03 -- GET /api/category-budgets?month=YYYY-MM (defaults to the
// current month). Reads accept any valid month (I6).
const { UserModel } = require("../../config/Schemas");
const { getSummary } = require("../../Services/BudgetServices/categoryBudget.service");
const { currentMonth, parseMonth } = require("../../Services/BudgetServices/categoryBudgetContract");
const { sendSuccess, sendRejection, sendUserMissing, sendServerError } = require("./respond");

const getCategoryBudgets = async (req, res) => {
  try {
    const user = await UserModel.findById(req.userId);
    if (!user) return sendUserMissing(res);

    const now = new Date();
    const rawMonth = req.query && req.query.month !== undefined ? req.query.month : currentMonth(now);
    const parsed = parseMonth(rawMonth);
    if (!parsed.ok) return sendRejection(res, { reason: parsed.reason, field: "month" });

    const summary = await getSummary(user._id, parsed.month, { now });
    return sendSuccess(res, summary);
  } catch (err) {
    return sendServerError(res, err);
  }
};

module.exports = { getCategoryBudgets };
