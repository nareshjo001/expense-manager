"use strict";

// After a successful write the data is already committed, so a failure to
// build the follow-up summary must not turn the response into a 500 (a
// client retrying a committed delete would get a misleading 404). The
// client falls back to GET /api/category-budgets when summary is null.
const { getSummary } = require("../../Services/BudgetServices/categoryBudget.service");
const { logEvent } = require("../../utils/logger");

async function summaryAfterWrite(userId, month, now) {
  try {
    return await getSummary(userId, month, { now });
  } catch (err) {
    logEvent({
      level: "error",
      scope: "category-budget",
      event: "summary_after_write_failed",
      feature: "BUD-001",
      userId: String(userId),
      month,
      errorName: (err && err.name) || "Error",
    });
    return null;
  }
}

module.exports = { summaryAfterWrite };
