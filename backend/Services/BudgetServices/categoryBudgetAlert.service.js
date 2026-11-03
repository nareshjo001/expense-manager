"use strict";

// Md). synchronizeAfterMutation() after EVERY expense (and total-budget) mutation, for every user -- so the common case ("this user has no cat.

const mongoose = require("mongoose");
const { CategoryBudgetModel } = require("../../models/CategoryBudget");
const { NOTIFICATION_TYPES } = require("../../utils/notificationTypes");
const { aggregateSpentByCategory } = require("./categoryBudgetSpend");
const {
  ALERT_LEVELS,
  alertLevelForMinor,
  utilizationPercent,
  formatMonth,
  currentMonth,
} = require("./categoryBudgetContract");
const { logEvent } = require("../../utils/logger");

const LOG_SCOPE = "category-budget-alert";
const FEATURE = "BUD-001";
const PUSH_RETRY_DELAY_MS = 5 * 60 * 1000; // same as cron/recurringJob.js
const MONGOOSE_CONNECTED = 1;

// Fixed English names rather than toLocaleString(), so the copy does not
// depend on the server's ICU/locale build.
const MONTH_NAMES = Object.freeze([
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]);

// Never logs amounts or category names -- ids, month, level and reason
// codes only.
function log(event, { level = "info", userId, month, alertLevel, reason, pushStatus, count } = {}) {
  logEvent({
    level,
    scope: LOG_SCOPE,
    event,
    feature: FEATURE,
    userId: userId === undefined ? undefined : String(userId),
    month,
    alertLevel,
    reason,
    pushStatus,
    count,
  });
}

function errorReason(err) {
  return (err && typeof err.name === "string" && err.name) || "Error";
}

// "September", or "September 2025" when the month is not in `now`'s year.
function monthLabel(month, now) {
  const [year, monthNumber] = month.split("-").map(Number);
  const name = MONTH_NAMES[monthNumber - 1];
  return year === now.getFullYear() ? name : `${name} ${year}`;
}

// Deliberately no rupee amounts (financial data minimization: push preview
// modes can put the body on a lock screen).
function buildMessage({ category, month, alertLevel, utilization, now }) {
  const label = monthLabel(month, now);
  const title = `Budget alert: ${category}`;
  const message =
    alertLevel === ALERT_LEVELS.OVERSPENT
      ? `You've gone over your ${category} budget for ${label}.`
      : `You've used ${Math.round(utilization)}% of your ${category} budget for ${label}.`;
  return { title, message };
}

function distinctMonths(dates) {
  const months = new Set();
  for (const raw of Array.isArray(dates) ? dates : []) {
    const date = raw instanceof Date ? raw : new Date(raw);
    if (raw === null || raw === undefined || Number.isNaN(date.getTime())) continue;
    months.add(formatMonth(date));
  }
  return [...months];
}

// Mirrors cron/recurringJob.js: sent / suppressed (terminal, never retried)
// / failed (queued for cron/retryPush.js, which re-applies the type gate).
function pushStatusUpdate(pushResult) {
  if (pushResult && pushResult.success) return { pushStatus: "sent" };
  if (pushResult && pushResult.suppressed) return { pushStatus: "suppressed" };
  return {
    pushStatus: "failed",
    retryCount: 1,
    nextRetryAt: new Date(Date.now() + PUSH_RETRY_DELAY_MS),
  };
}

// SynchronizeAfterMutation) goes through.
function loadNotifier() {
  const Notification = require("../../models/Notification");
  const { sendPush } = require("../push.service");
  return { Notification, sendPush };
}

async function notify({ userId, allocation, month, alertLevel, utilization, now }) {
  const { Notification, sendPush } = loadNotifier();
  const { title, message } = buildMessage({
    category: allocation.category,
    month,
    alertLevel,
    utilization,
    now,
  });

  const notification = await Notification.create({
    userId,
    title,
    message,
    type: NOTIFICATION_TYPES.CATEGORY_BUDGET_ALERT,
  });

  let pushResult;
  try {
    pushResult = await sendPush(String(userId), notification.title, notification.message, {
      type: notification.type,
    });
  } catch (_err) {
    // The notification row exists; a thrown send is recorded as a failed
    // push so retryPush.js picks it up, exactly like a { success: false }.
    pushResult = { success: false };
  }

  const update = pushStatusUpdate(pushResult);
  await Notification.updateOne({ _id: notification._id }, update);
  return update.pushStatus;
}

async function evaluateMonth({ userId, month, now, summary }) {
  const allocations = await CategoryBudgetModel.find({ userId, month })
    .select("_id category amountMinor lastAlertLevel")
    .lean();

  // The hot path: no allocations, no aggregation.
  if (!allocations || allocations.length === 0) return;

  summary.evaluatedMonths.push(month);
  const { byCategory } = await aggregateSpentByCategory(userId, month);

  for (const allocation of allocations) {
    const spentMinor = byCategory.get(allocation.category) || 0;
    const utilization = utilizationPercent(spentMinor, allocation.amountMinor);
    const alertLevel = alertLevelForMinor(spentMinor, allocation.amountMinor);
    const previousLevel = Number.isInteger(allocation.lastAlertLevel)
      ? allocation.lastAlertLevel
      : ALERT_LEVELS.NONE;
    if (alertLevel <= previousLevel) continue;

    try {
      // `$not: { $gte }` also matches a missing/null lastAlertLevel, which a
      // plain `$lt` would silently skip.
      const claim = await CategoryBudgetModel.updateOne(
        {
          _id: allocation._id,
          userId,
          amountMinor: allocation.amountMinor,
          lastAlertLevel: { $not: { $gte: alertLevel } },
        },
        { $set: { lastAlertLevel: alertLevel } }
      );
      if (!claim || claim.modifiedCount !== 1) {
        log("claim_lost", { userId, month, alertLevel });
        continue;
      }

      const pushStatus = await notify({ userId, allocation, month, alertLevel, utilization, now });
      summary.notified.push({ month, category: allocation.category, level: alertLevel });
      log("notified", { userId, month, alertLevel, pushStatus });
    } catch (err) {
      summary.errors.push({ month, stage: "notify", reason: errorReason(err) });
      log("notify_failed", { level: "error", userId, month, alertLevel, reason: errorReason(err) });
    }
  }
}

// Returns { evaluatedMonths, notified: [{ month, category, level }], errors,
// skipped }. Never throws.
async function evaluateCategoryBudgetAlerts({ userId, dates = [], now = new Date() } = {}) {
  const summary = { evaluatedMonths: [], notified: [], errors: [], skipped: null };

  try {
    if (!userId) {
      summary.skipped = "no_user";
      return summary;
    }

    const today = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    const thisMonth = currentMonth(today);
    // I14 scope: the CURRENT month only.
    const months = distinctMonths(dates).filter((month) => month === thisMonth);
    if (months.length === 0) {
      summary.skipped = "no_eligible_months";
      return summary;
    }

    // With the connection down, Mongoose would BUFFER these queries (up to bufferTimeoutMS) on the expense-write path.
    if (!mongoose.connection || mongoose.connection.readyState !== MONGOOSE_CONNECTED) {
      summary.skipped = "db_unavailable";
      log("skipped", { level: "warn", userId, reason: summary.skipped });
      return summary;
    }

    for (const month of months) {
      try {
        await evaluateMonth({ userId, month, now: today, summary });
      } catch (err) {
        summary.errors.push({ month, stage: "evaluate", reason: errorReason(err) });
        log("evaluate_failed", { level: "error", userId, month, reason: errorReason(err) });
      }
    }
  } catch (err) {
    summary.errors.push({ month: null, stage: "setup", reason: errorReason(err) });
    log("evaluate_failed", { level: "error", userId, reason: errorReason(err) });
  }

  return summary;
}

module.exports = {
  evaluateCategoryBudgetAlerts,
  // Exported for tests.
  buildMessage,
  distinctMonths,
};
