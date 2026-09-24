"use strict";

// AI-001-T05 -- user opt-in and regeneration limits for the monthly AI
// summary. Two independent concerns living in one service, matching
// NOT-003's notificationPreferenceService.js precedent (flagged reusable
// for this exact task by AI-001-T01's audit):
//   1. optedIn: the feature is OFF for a user until they explicitly opt in
//      (this feature's outcome statement is "opt-in", not
//      opt-out/default-on).
//   2. A rolling monthly cap on how many times a user may (re)generate an
//      LLM-authored summary -- separate from, and in addition to,
//      utils/rateLimiter.js's aiSummaryLimiter HTTP-level sliding-window
//      limiter, which only guards against short-burst abuse and resets
//      every 15 minutes. This cap is a business rule ("N per calendar
//      month") that must survive restarts and outlive any single
//      15-minute window, so it is a persisted counter, not
//      express-rate-limit state.
const AiSummaryPreference = require("../models/AiSummaryPreference");
const { getZonedYMD } = require("./periodResolver");
const config = require("./config");
// AI-001-T07 -- a successful regeneration is the best available proxy this
// codebase has for "was the summary useful": there is no explicit user
// feedback mechanism (a thumbs up/down) today, so a rising regeneration
// rate per opted-in user is read as a WEAK dissatisfaction signal (the
// previous summary did not answer what the user wanted) rather than proof
// of either satisfaction or dissatisfaction on its own -- see this
// feature's T07 deliverable notes for the full caveat. Recorded only on
// the ALLOWED path (a rejected attempt never reaches here), so this count
// is never inflated by opt-in/limit-gate rejections.
const { recordOperation } = require("../utils/metrics");

// Same normalization discipline as sia/config.js's own normalizeTimeoutMs:
// a missing/invalid env value falls back to a safe default, never throws,
// never NaN.
function normalizeMaxRegenerations(rawValue) {
  if (typeof rawValue !== "string" || rawValue.trim() === "") return DEFAULT_MAX_REGENERATIONS_PER_MONTH;
  const parsed = Number(rawValue.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_MAX_REGENERATIONS_PER_MONTH;
  return parsed;
}

const DEFAULT_MAX_REGENERATIONS_PER_MONTH = 5;
const MAX_REGENERATIONS_PER_MONTH = normalizeMaxRegenerations(process.env.AI_SUMMARY_MAX_REGENERATIONS_PER_MONTH);

// "YYYY-MM" in the app's configured time zone -- the same zone every other
// period-sensitive SIA computation uses (periodResolver.js/config.js),
// so a user's monthly cap resets on the same month boundary their reports
// and SIA answers already use, never UTC's boundary.
function currentPeriodKey(now = new Date()) {
  const { year, month } = getZonedYMD(now, config.appTimeZone);
  return `${year}-${String(month).padStart(2, "0")}`;
}

// The full view a settings/usage UI needs: opted-in state plus this
// period's regeneration usage -- never a partial document a caller would
// need to fill gaps in itself.
async function getPreference(userId, now = new Date()) {
  const doc = await AiSummaryPreference.findOne({ userId }).lean();
  const period = currentPeriodKey(now);
  // A stored period that doesn't match the current one is stale usage from
  // an earlier month -- treated as 0 here (read-time reset), never written
  // back by a read; only recordRegeneration() below persists the reset,
  // and only when it actually records a new regeneration.
  const regenerationsUsed = doc && doc.regenerationPeriod === period ? doc.regenerationCount || 0 : 0;
  return {
    optedIn: doc?.optedIn === true,
    period,
    regenerationsUsed,
    regenerationLimit: MAX_REGENERATIONS_PER_MONTH,
    regenerationsRemaining: Math.max(0, MAX_REGENERATIONS_PER_MONTH - regenerationsUsed),
    updatedAt: doc?.updatedAt ?? null,
  };
}

// Upserts the opt-in flag only -- never touches the regeneration counter,
// matching notificationPreferenceService.savePreferences's "only fields
// actually present are applied" convention.
async function setOptIn(userId, optedIn) {
  if (typeof optedIn !== "boolean") {
    return { ok: false, reason: "invalid_opted_in" };
  }
  await AiSummaryPreference.findOneAndUpdate(
    { userId },
    { $set: { optedIn }, $setOnInsert: { userId } },
    { upsert: true, new: true }
  );
  return { ok: true, preference: await getPreference(userId) };
}

// The single gate the generate/regenerate route must call before invoking
// generateMonthlySummary({ allowLlm: true }). Returns
// { allowed: true, regenerationsUsed, regenerationLimit, regenerationsRemaining }
// on success (and has already incremented/persisted the new count), or
// { allowed: false, reasonCode: "NOT_OPTED_IN" | "REGENERATION_LIMIT_EXCEEDED", ... }
// without incrementing anything -- a rejected attempt never consumes a
// regeneration credit.
async function recordRegeneration(userId, now = new Date()) {
  const doc = await AiSummaryPreference.findOne({ userId }).lean();
  if (doc?.optedIn !== true) {
    return { allowed: false, reasonCode: "NOT_OPTED_IN" };
  }

  const period = currentPeriodKey(now);
  const currentCount = doc.regenerationPeriod === period ? doc.regenerationCount || 0 : 0;

  if (currentCount >= MAX_REGENERATIONS_PER_MONTH) {
    return {
      allowed: false,
      reasonCode: "REGENERATION_LIMIT_EXCEEDED",
      regenerationsUsed: currentCount,
      regenerationLimit: MAX_REGENERATIONS_PER_MONTH,
      regenerationsRemaining: 0,
    };
  }

  const nextCount = currentCount + 1;
  await AiSummaryPreference.findOneAndUpdate(
    { userId },
    { $set: { regenerationPeriod: period, regenerationCount: nextCount }, $setOnInsert: { userId } },
    { upsert: true, new: true }
  );

  recordOperation({ scope: "ai_summary", operation: "regeneration", outcome: "success" });

  return {
    allowed: true,
    regenerationsUsed: nextCount,
    regenerationLimit: MAX_REGENERATIONS_PER_MONTH,
    regenerationsRemaining: Math.max(0, MAX_REGENERATIONS_PER_MONTH - nextCount),
  };
}

module.exports = {
  getPreference,
  setOptIn,
  recordRegeneration,
  MAX_REGENERATIONS_PER_MONTH,
  // Exported for direct unit testing without a DB round trip.
  currentPeriodKey,
};
