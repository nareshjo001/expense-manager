"use strict";

// BUD-001-T03 -- DELETE /api/category-budgets/:id. Owner-scoped (I13); a
// replayed delete returns 404 (I12); past months are read-only (I6).
const { UserModel } = require("../../config/Schemas");
const { deleteCategoryBudget } = require("../../Services/BudgetServices/categoryBudget.service");
const { sendSuccess, sendRejection, sendUserMissing, sendServerError } = require("./respond");
const { summaryAfterWrite } = require("./summaryAfterWrite");

const deleteCategoryBudgetController = async (req, res) => {
  try {
    const user = await UserModel.findById(req.userId);
    if (!user) return sendUserMissing(res);

    const now = new Date();
    const result = await deleteCategoryBudget(user._id, req.params && req.params.id, { now });
    if (!result.ok) return sendRejection(res, result);

    const summary = await summaryAfterWrite(user._id, result.month, now);
    return sendSuccess(res, { deletedId: result.deletedId, summary });
  } catch (err) {
    return sendServerError(res, err);
  }
};

module.exports = { deleteCategoryBudget: deleteCategoryBudgetController };
