"use strict";

// BUD-001-T03 -- shared HTTP mapping for the category-budget controllers.
// Every response, success or error, carries contractVersion (I16); errors
// follow the existing { success: false, message, errorCode, field? } shape.
const { CONTRACT_VERSION, ERROR_CODES } = require("../../Services/BudgetServices/categoryBudgetContract");

const REASON_MESSAGES = {
  [ERROR_CODES.INVALID_MONTH]: "month must be a valid YYYY-MM month",
  [ERROR_CODES.MONTH_NOT_WRITABLE]: "Category budgets can only be changed for the current month and up to 11 months ahead",
  [ERROR_CODES.INVALID_CATEGORY]: "category must be a valid category name of at most 50 characters",
  [ERROR_CODES.RESERVED_CATEGORY]: "Uncategorized cannot have a category budget",
  [ERROR_CODES.INVALID_AMOUNT]: "amount must be a positive number with at most 2 decimal places",
  [ERROR_CODES.AMOUNT_OUT_OF_RANGE]: "amount must be greater than 0 and at most 1,000,000,000",
  [ERROR_CODES.TOO_MANY_CATEGORY_BUDGETS]: "A month can have at most 25 category budgets",
  [ERROR_CODES.CATEGORY_BUDGET_EXCEEDS_TOTAL]: "Category budgets cannot add up to more than the month's total budget",
  [ERROR_CODES.CATEGORY_BUDGET_NOT_FOUND]: "Category budget not found",
  [ERROR_CODES.INVALID_ID]: "Invalid category budget id",
};

const REASON_STATUS = {
  [ERROR_CODES.TOO_MANY_CATEGORY_BUDGETS]: 409,
  [ERROR_CODES.CATEGORY_BUDGET_EXCEEDS_TOTAL]: 409,
  [ERROR_CODES.CATEGORY_BUDGET_NOT_FOUND]: 404,
};

function sendSuccess(res, data) {
  return res.status(200).json({ success: true, contractVersion: CONTRACT_VERSION, data });
}

// Every known reason not listed in REASON_STATUS is a validation failure.
function sendRejection(res, { reason, field }) {
  const body = {
    success: false,
    contractVersion: CONTRACT_VERSION,
    message: REASON_MESSAGES[reason] || "Invalid category budget request",
    errorCode: reason,
  };
  if (field) body.field = field;
  return res.status(REASON_STATUS[reason] || 400).json(body);
}

function sendUserMissing(res) {
  return res.status(401).json({
    success: false,
    contractVersion: CONTRACT_VERSION,
    message: "User does not exist",
  });
}

function sendServerError(res, err) {
  console.error(err);
  return res.status(500).json({
    success: false,
    contractVersion: CONTRACT_VERSION,
    message: "Internal Server Error",
  });
}

module.exports = { sendSuccess, sendRejection, sendUserMissing, sendServerError, REASON_MESSAGES };
