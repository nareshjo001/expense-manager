"use strict";

// BUD-001-T03 -- CRUD and total-budget reconciliation for category budgets.
// Every rule enforced here is stated once in
// docs/budgets/BUD-001-T01-category-budget-invariants.md; validation and
// constants come from categoryBudgetContract.js (never re-declared here),
// per-category spent from categoryBudgetSpend.js (I9), and the summary
// shape from analytics/analyzers/categoryBudgetAnalyzer.js.
//
// Service functions return { ok: true, ... } or { ok: false, reason, field }
// (same split as NotificationServices/notificationPreferenceService.js); the
// controllers own the HTTP status mapping. Unexpected datastore errors are
// thrown, never converted into a validation reason.

const { BudgetModel } = require("../../config/Schemas");
const { CategoryBudgetModel } = require("../../models/CategoryBudget");
const {
  ERROR_CODES,
  MAX_CATEGORY_BUDGETS_PER_MONTH,
  ALERT_LEVELS,
  parseMonth,
  isWritableMonth,
  monthToDate,
  normalizeBudgetCategory,
  parseBudgetAmount,
} = require("./categoryBudgetContract");
const { aggregateSpentByCategory, toObjectId } = require("./categoryBudgetSpend");
const { getMonthKey } = require("./budget.service");
const { toMinorUnits } = require("../../utils/money");
const { analyzeCategoryBudgets } = require("../../analytics/analyzers/categoryBudgetAnalyzer");
const { logEvent } = require("../../utils/logger");

const LOG_SCOPE = "category-budget";
const FEATURE = "BUD-001";
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

// Never logs amounts or category names -- only ids, month and reason codes.
function log(event, { userId, month, reason, created } = {}) {
  logEvent({
    level: event === "rejected" ? "warn" : "info",
    scope: LOG_SCOPE,
    event,
    feature: FEATURE,
    userId: userId === undefined ? undefined : String(userId),
    month,
    reason,
    created,
  });
}

function reject(reason, field, context = {}) {
  log("rejected", { ...context, reason });
  return field ? { ok: false, reason, field } : { ok: false, reason };
}

function sumAllocatedMinor(allocations) {
  return allocations.reduce((total, doc) => {
    const minor = Number(doc && doc.amountMinor);
    return Number.isFinite(minor) ? total + minor : total;
  }, 0);
}

// The month's total budget in integer paise, or null when no total is set
// (I1/I7: a month may have category budgets without a total). The total
// lives in the legacy BudgetModel under its "MMM YYYY" key.
async function getTotalBudgetMinor(userObjectId, month) {
  const doc = await BudgetModel.findOne({
    userId: userObjectId,
    month: getMonthKey(monthToDate(month)),
  }).lean();
  if (!doc) return null;

  if (Number.isInteger(doc.budgetMinor)) {
    return doc.budgetMinor > 0 ? doc.budgetMinor : null;
  }
  const rupees = Number(doc.budget);
  if (!Number.isFinite(rupees) || rupees <= 0) return null;
  return toMinorUnits(rupees);
}

async function loadAllocations(userObjectId, month) {
  return CategoryBudgetModel.find({ userId: userObjectId, month }).lean();
}

// `month` must already be a valid "YYYY-MM" (the controller validates it).
async function getSummary(userId, month, { now = new Date() } = {}) {
  const userObjectId = toObjectId(userId);
  const [allocations, spent, totalBudgetMinor] = await Promise.all([
    loadAllocations(userObjectId, month),
    aggregateSpentByCategory(userObjectId, month),
    getTotalBudgetMinor(userObjectId, month),
  ]);

  return analyzeCategoryBudgets({
    month,
    allocations,
    spentByCategory: spent.byCategory,
    totalSpentMinor: spent.totalSpentMinor,
    totalBudgetMinor,
    now,
    writable: isWritableMonth(month, now),
  });
}

// I8 compensation: undo only OUR write. Each rollback is conditional on the
// document still holding the amount this request wrote, so a newer write by
// another request is never clobbered.
async function compensate({ key, created, previous, amountMinor }) {
  if (created) {
    await CategoryBudgetModel.deleteOne({ ...key, amountMinor });
    return;
  }
  await CategoryBudgetModel.updateOne(
    { ...key, amountMinor },
    {
      $set: {
        amount: previous.amount,
        amountMinor: previous.amountMinor,
        lastAlertLevel: Number.isInteger(previous.lastAlertLevel)
          ? previous.lastAlertLevel
          : ALERT_LEVELS.NONE,
      },
    }
  );
}

async function upsertCategoryBudget(userId, input, { now = new Date() } = {}) {
  const userObjectId = toObjectId(userId);
  const context = { userId: userObjectId };
  const { month: rawMonth, category: rawCategory, amount: rawAmount } = input || {};

  const parsedMonth = parseMonth(rawMonth);
  if (!parsedMonth.ok) return reject(parsedMonth.reason, "month", context);
  const { month } = parsedMonth;
  context.month = month;

  // I6
  if (!isWritableMonth(month, now)) {
    return reject(ERROR_CODES.MONTH_NOT_WRITABLE, "month", context);
  }

  // I2/I3
  const parsedCategory = normalizeBudgetCategory(rawCategory);
  if (!parsedCategory.ok) return reject(parsedCategory.reason, "category", context);
  const { category } = parsedCategory;

  // I4
  const parsedAmount = parseBudgetAmount(rawAmount);
  if (!parsedAmount.ok) return reject(parsedAmount.reason, "amount", context);
  const { amount, amountMinor } = parsedAmount;

  const key = { userId: userObjectId, month, category };
  const [existing, totalBudgetMinor] = await Promise.all([
    loadAllocations(userObjectId, month),
    getTotalBudgetMinor(userObjectId, month),
  ]);
  const current = existing.find((doc) => doc.category === category) || null;

  // I5 -- only a create counts against the cap.
  if (!current && existing.length >= MAX_CATEGORY_BUDGETS_PER_MONTH) {
    return reject(ERROR_CODES.TOO_MANY_CATEGORY_BUDGETS, "category", context);
  }

  // I7 -- a write that does not increase the allocation never makes the sum
  // exceed the total (it can only keep or reduce an existing over-allocation
  // caused by a later total-budget edit), so only increases are checked.
  const isIncrease = !current || amountMinor > current.amountMinor;
  if (totalBudgetMinor !== null && isIncrease) {
    const othersMinor = sumAllocatedMinor(existing.filter((doc) => doc.category !== category));
    if (othersMinor + amountMinor > totalBudgetMinor) {
      return reject(ERROR_CODES.CATEGORY_BUDGET_EXCEEDS_TOTAL, "amount", context);
    }
  }

  // I12 -- a single upsert keyed on (userId, month, category). The
  // pre-image (returnDocument: "before") tells us atomically whether this
  // request created the document and what to restore under I8.
  const $set = { amount, amountMinor };
  const amountChanged = !current || current.amountMinor !== amountMinor;
  if (amountChanged) $set.lastAlertLevel = ALERT_LEVELS.NONE; // I14

  const upsertOnce = () =>
    CategoryBudgetModel.findOneAndUpdate(
      key,
      { $set },
      { upsert: true, returnDocument: "before", runValidators: true, setDefaultsOnInsert: true }
    ).lean();

  let previous;
  try {
    previous = await upsertOnce();
  } catch (err) {
    // Two concurrent upserts of the same new key: the loser hits the unique
    // index. Retrying converges on an update of the winner's document.
    if (!err || err.code !== 11000) throw err;
    previous = await upsertOnce();
  }
  const created = !previous;

  // The pre-read was stale and the amount really did change: I14 still
  // requires the reset. Conditional on our amount so a newer write wins.
  if (!created && !amountChanged && previous.amountMinor !== amountMinor) {
    await CategoryBudgetModel.updateOne(
      { ...key, amountMinor },
      { $set: { lastAlertLevel: ALERT_LEVELS.NONE } }
    );
  }

  // I8 -- re-read the month's allocated sum after the write.
  const after = await loadAllocations(userObjectId, month);
  const delta = created ? amountMinor : amountMinor - previous.amountMinor;
  if (totalBudgetMinor !== null && delta > 0 && sumAllocatedMinor(after) > totalBudgetMinor) {
    await compensate({ key, created, previous, amountMinor });
    return reject(ERROR_CODES.CATEGORY_BUDGET_EXCEEDS_TOTAL, "amount", context);
  }

  const written = after.find((doc) => doc.category === category) || previous || null;
  log(created ? "created" : "updated", context);

  return {
    ok: true,
    budget: {
      id: written && written._id ? String(written._id) : null,
      month,
      category,
      amount,
      amountMinor,
      created,
    },
  };
}

// I6/I12/I13 -- scoped by owner; another user's id and a nonexistent id are
// indistinguishable (both CATEGORY_BUDGET_NOT_FOUND).
async function deleteCategoryBudget(userId, id, { now = new Date() } = {}) {
  const userObjectId = toObjectId(userId);
  const context = { userId: userObjectId };

  if (typeof id !== "string" || !OBJECT_ID_PATTERN.test(id)) {
    return reject(ERROR_CODES.INVALID_ID, "id", context);
  }

  const existing = await CategoryBudgetModel.findOne({ _id: id, userId: userObjectId }).lean();
  if (!existing) return reject(ERROR_CODES.CATEGORY_BUDGET_NOT_FOUND, "id", context);
  context.month = existing.month;

  if (!isWritableMonth(existing.month, now)) {
    return reject(ERROR_CODES.MONTH_NOT_WRITABLE, "id", context);
  }

  const deleted = await CategoryBudgetModel.findOneAndDelete({
    _id: existing._id,
    userId: userObjectId,
  }).lean();
  // Deleted concurrently between the read and the delete -- same outcome as
  // a replayed delete (I12).
  if (!deleted) return reject(ERROR_CODES.CATEGORY_BUDGET_NOT_FOUND, "id", context);

  log("deleted", context);
  return { ok: true, deletedId: String(deleted._id), month: deleted.month };
}

module.exports = {
  getSummary,
  upsertCategoryBudget,
  deleteCategoryBudget,
  getTotalBudgetMinor,
};
