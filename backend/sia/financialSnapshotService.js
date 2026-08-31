// Builds the sanitized, authenticated-user financial report sent to SIA.
"use strict";

const reportService = require("../Services/reportService");
const financialQueryService = require("./financialQueryService");
const { resolvePeriod } = require("./periodResolver");

const REPORT_KEYS = Object.freeze([
  "summary",
  "spending",
  "budgets",
  "categories",
  "trends",
  "habits",
  "financialHealth",
  "forecast",
  "anomalies",
]);
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 10;
const MAX_OBJECT_KEYS = 25;
const MAX_STRING_LENGTH = 500;
const MAX_ANALYTICS_SERIALIZED_CHARS = 16000;
const FORBIDDEN_KEY_PATTERN = /(?:^|_)(?:id|userid|user|_id|expenseid|transactionid|merchant|description|receipt|expensename|expensedate|name|title|details|note|narration)(?:$|_)/i;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function copySafe(value, depth = 0) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value.slice(0, MAX_STRING_LENGTH);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (depth >= MAX_DEPTH) return null;
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => copySafe(item, depth + 1));
  if (!isPlainObject(value)) return null;

  const copy = {};
  for (const [key, nestedValue] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) continue;
    const nestedCopy = copySafe(nestedValue, depth + 1);
    if (nestedCopy !== null) copy[key] = nestedCopy;
  }
  return copy;
}

async function buildFinancialSnapshot(userId, { now, timeZone } = {}) {
  const currentMonth = resolvePeriod({ type: "CURRENT_MONTH" }, { now, timeZone });
  if (!currentMonth.ok) return { ok: false, reasonCode: "CURRENT_PERIOD_UNAVAILABLE" };

  let report;
  let incomeTotal;
  let incomeBreakdown;
  try {
    [report, incomeTotal, incomeBreakdown] = await Promise.all([
      reportService.getReport(userId),
      financialQueryService.getIncomeTotal(userId, currentMonth),
      financialQueryService.getIncomeBreakdown(userId, currentMonth),
    ]);
  } catch (_err) {
    return { ok: false, reasonCode: "SNAPSHOT_UNAVAILABLE" };
  }

  const analytics = {};
  for (const key of REPORT_KEYS) {
    if (!report || report[key] === undefined) continue;
    const candidate = copySafe(report[key]);
    if (candidate === null) continue;
    const nextAnalytics = { ...analytics, [key]: candidate };
    if (JSON.stringify(nextAnalytics).length > MAX_ANALYTICS_SERIALIZED_CHARS) continue;
    analytics[key] = candidate;
  }

  return {
    ok: true,
    snapshot: {
      period: { label: currentMonth.label, start: currentMonth.start.toISOString(), end: currentMonth.end.toISOString() },
      analytics,
      income: {
        currentMonthTotal: incomeTotal && incomeTotal.hasData ? incomeTotal.value : null,
        currentMonthCount: incomeTotal && incomeTotal.hasData ? incomeTotal.count : null,
        sources: incomeBreakdown && incomeBreakdown.hasData ? copySafe(incomeBreakdown.sources || []) : [],
      },
    },
  };
}

module.exports = { buildFinancialSnapshot, copySafe };
