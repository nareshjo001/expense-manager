"use strict";

// BUD-001-T06 -- optional category budget alerts (invariant I14 in
// docs/budgets/BUD-001-T01-category-budget-invariants.md).
//
// Called by syncRecoveryService.synchronizeAfterMutation() after EVERY
// expense (and total-budget) mutation, for every user -- so the common case
// ("this user has no category budgets for that month") must cost exactly
// one indexed, lean find() and nothing else: no spend aggregation, no
// notification work.
//
// At-most-once per level per allocation: the level is claimed with a single
// conditional updateOne on the allocation document BEFORE any notification
// is created, so of two concurrent mutations that both see a crossing, only
// the one whose update actually modified the document notifies. The claim
// is also conditioned on the amountMinor the level was computed against, so
// an amount change racing this evaluation (which resets lastAlertLevel to 0
// in the upsert service) can never be overwritten by a level computed
// against the old amount.
//
// This function never lowers lastAlertLevel (spend dropping back below a
// threshold does not re-arm an alert; only an amount change does) and never
// throws: every failure is logged and returned in `errors`, so an alert can
// never change the outcome of the expense write that triggered it.

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

// Required lazily: push.service pulls in firebase-admin, which this module
// only needs on the rare threshold-crossing path -- never on the per-mutation
// hot path that every expense write (and every test exercising
// syncRecoveryService.synchronizeAfterMutation) goes through.
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
    // I14 scope: the CURRENT month only. A future month has no spend to act
    // on, and a past month is closed -- a historical import (which passes
    // many past dates) would otherwise fire alerts about months the user
    // can no longer do anything about.
    const months = distinctMonths(dates).filter((month) => month === thisMonth);
    if (months.length === 0) {
      summary.skipped = "no_eligible_months";
      return summary;
    }

    // With the connection down, Mongoose would BUFFER these queries (up to
    // bufferTimeoutMS) on the expense-write path. Skipping is safe: nothing
    // is claimed, so the next mutation re-evaluates from lastAlertLevel and
    // sends any alert missed here.
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
