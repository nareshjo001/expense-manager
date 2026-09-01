// SIA answer-grounding transparency -- produces the small, human-readable "which BALENISA analytics were used" disclosure that rides alongside a generated answer. NOT the internal `basedOn` field (responseFormatter.js, unchanged here) -- that's an intent-keyed list of raw internal Report field paths for grounded-response validation; `grounding` is a separate, additive, user-facing contract of stable allowlisted keys, short labels, and an optional period, never a raw path/metric value/anything the LLM said. THE RULE THIS MODULE ENFORCES: a source is listed if and only if its field is actually present on the exact `contextResult.fields` object handed to the provider for THIS answer -- never because the classifier merely selected a section, never guessed from the intent name; contextBuilder.js's per-intent isPresent gates guarantee a field is only set when it's real, validated data, so reading `contextResult.fields`'s own keys is the smallest and most honest source of truth -- no second analytics query is ever made.
"use strict";

// The complete allowlist. `fieldKey` is one of the top-level keys contextBuilder.js's `fields` object can carry, across all eight supported intents (the eighth, CURRENT_SPENDING_SUMMARY, uses only the existing `summary` entry below -- no new allowlist entry was needed). `key` is the stable, server-owned identifier returned to callers -- deliberately equal to `fieldKey` since these are already-generic category names, never internal paths or Mongo ids. `label` is the only human-readable text a client renders. Order here is also the ONLY ordering used when producing a snapshot -- never object-key insertion order, so output is deterministic regardless of how contextBuilder.js constructs `fields`.
const GROUNDING_SOURCE_ALLOWLIST = Object.freeze([
  Object.freeze({ fieldKey: "financialHealth", key: "financialHealth", label: "Financial health analysis" }),
  Object.freeze({ fieldKey: "summary", key: "summary", label: "Financial summary" }),
  Object.freeze({ fieldKey: "trends", key: "trends", label: "Spending trends" }),
  Object.freeze({ fieldKey: "budget", key: "budget", label: "Budget status" }),
  Object.freeze({ fieldKey: "categories", key: "categories", label: "Category spending breakdown" }),
  Object.freeze({ fieldKey: "anomalies", key: "anomalies", label: "Unusual spending detection" }),
  Object.freeze({ fieldKey: "forecast", key: "forecast", label: "Spending forecast" }),
  Object.freeze({ fieldKey: "risk", key: "risk", label: "Financial risk signals" }),
]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPresent(value) {
  return value !== undefined && value !== null;
}

// `sourceReportGeneratedAt` is WHEN the report was generated, not the analytics PERIOD a section represents -- an earlier version used it as every source's `period`, which was factually wrong (relabelling a generation date as a reporting period), and has been removed. No allowlisted section currently carries an explicit single-value period field (trends.monthlyTrend is an array of per-month entries; forecast's historyMonthsUsed/horizonMonths are durations). `period` therefore stays permanently unpopulated until a future change adds a genuine period field to a selected section -- this module still supports it structurally so that day requires no contract change, but nothing here may infer, compute from the current date, or reuse an unrelated timestamp in the meantime.
function resolveExplicitPeriod(fieldKey, sectionValue) {
  // No allowlisted section currently exposes an authoritative period value. `fieldKey`/`sectionValue` are accepted but not read, so the day a section gains one, this is the obvious place to read it from -- deliberately not from `contextResult.sourceReportGeneratedAt`.
  return undefined;
}

// Builds the immutable grounding snapshot for ONE answer, from the exact `contextResult` buildContext() already returned for this turn -- called once, right after context is built and BEFORE the provider is invoked, so this can never be influenced by or parsed out of the LLM's answer text or prompt.
function buildGroundingSnapshot(contextResult) {
  if (!contextResult || !isPlainObject(contextResult.fields)) {
    return { sources: [] };
  }

  const fields = contextResult.fields;
  const seenKeys = new Set();
  const sources = [];

  for (const entry of GROUNDING_SOURCE_ALLOWLIST) {
    if (seenKeys.has(entry.key)) continue; // defensive: allowlist keys are already unique
    if (!Object.prototype.hasOwnProperty.call(fields, entry.fieldKey)) continue;
    if (!isPresent(fields[entry.fieldKey])) continue;

    seenKeys.add(entry.key);
    const source = { key: entry.key, label: entry.label };
    // Per-section, not report-wide -- currently always undefined; `period` remains correctly omitted.
    const period = resolveExplicitPeriod(entry.fieldKey, fields[entry.fieldKey]);
    if (period !== undefined) source.period = period;
    sources.push(source);
  }

  return { sources };
}

module.exports = {
  buildGroundingSnapshot,
  GROUNDING_SOURCE_ALLOWLIST,
};
