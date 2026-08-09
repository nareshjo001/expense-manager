// SIA answer-grounding transparency -- Batch 3F.
//
// Produces the small, human-readable "which BALENISA analytics were used"
// disclosure that rides alongside a generated answer. This is NOT the
// existing internal `basedOn` field (backend/sia/responseFormatter.js,
// Batch 3D/M3-4) -- `basedOn` is an intent-keyed list of raw internal Report
// field paths (e.g. "financialHealth.risk.label") kept for that milestone's
// own grounded-response-validation purpose and left completely unchanged
// here. `grounding` is a separate, additive, user-facing contract: stable
// allowlisted keys, short human labels, and an optional period -- never a
// raw path, never a metric value, never anything the LLM said or reasoned.
//
// THE RULE THIS MODULE ENFORCES: a source is listed if and only if its
// field is actually present on the exact `contextResult.fields` object that
// was handed to the provider for THIS answer -- never because the intent
// classifier merely selected a section, and never guessed from the intent
// name alone. backend/sia/contextBuilder.js's own per-intent isPresent
// gates already guarantee a field is only ever set when it is real,
// validated data (see that file's extensive contract comments), so reading
// `contextResult.fields`'s own keys here is both the smallest and the most
// honest source of truth -- no second analytics query is ever made.
"use strict";

// The complete allowlist. Every entry's `fieldKey` is one of the top-level
// keys backend/sia/contextBuilder.js's `fields` object can ever carry,
// across every one of the seven supported intents (see that file). `key` is
// the stable, server-owned identifier returned to callers (and, eventually,
// persisted) -- deliberately equal to `fieldKey` here since these are
// already-generic category names, not internal paths, Mongo ids, or
// anything else this milestone's "do not expose internal repository
// details" rule would forbid. `label` is the only human-readable text a
// client is meant to render. Order here is also the ONLY ordering used when
// producing a snapshot (see CANONICAL_ORDER below) -- never object-key
// insertion order, so output is deterministic regardless of how
// contextBuilder.js happens to construct `fields`.
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

// Batch 3F acceptance remediation: `sourceReportGeneratedAt` is WHEN the
// report was generated -- a timestamp about the report run itself -- not
// the analytics PERIOD any given section represents (e.g. "which month's
// budget/category data is this"). An earlier version of this module used
// it as every source's `period`, which was factually wrong (it silently
// relabelled a generation date as if it were a reporting period) and has
// been removed entirely. No section this module's allowlist covers
// currently carries an explicit, authoritative period field within its own
// contextBuilder.js-selected fields (confirmed by rereading every branch of
// buildContext(): HEALTH_EXPLANATION's financialHealth/summary, SPENDING_
// CHANGE_EXPLANATION's trends/summary, BUDGET_STATUS_EXPLANATION's budget,
// CATEGORY_SPENDING_EXPLANATION's categories, ANOMALY_EXPLANATION's
// anomalies, SPENDING_FORECAST_EXPLANATION's forecast, and FINANCIAL_RISK_
// EXPLANATION's risk none of them select a single field that names the
// calendar period the section covers -- trends.monthlyTrend is an ARRAY of
// per-month entries, and forecast's historyMonthsUsed/horizonMonths are
// DURATIONS, neither of which is one authoritative period value).
//
// `period` therefore stays permanently unpopulated below until a future,
// separately-approved change adds a genuine single-value period field to
// one of contextBuilder.js's selected sections -- this module still
// supports it (see the `source.period` assignment in buildGroundingSnapshot()
// below) so that day requires no contract change,
// but nothing here may infer, calculate from the current date, or reuse an
// unrelated timestamp to fill it in the meantime. No additional analytics
// query is performed to obtain one.
function resolveExplicitPeriod(fieldKey, sectionValue) {
  // No allowlisted section currently exposes an authoritative period value
  // within its own selected fields (see the comment above). `fieldKey` and
  // `sectionValue` are accepted here, not read, so the day a section does
  // gain one, this is the single, obvious place to read it from --
  // deliberately not from `contextResult.sourceReportGeneratedAt`.
  return undefined;
}

// Builds the immutable grounding snapshot for ONE answer, from the exact
// `contextResult` backend/sia/contextBuilder.js's buildContext() already
// returned for this turn -- called once, right after that context is built
// and BEFORE the provider is ever invoked (see
// Controllers/SiaControllers/ask.js), so this can never be influenced by,
// or parsed out of, the LLM's answer text or the constructed prompt.
//
// Always returns `{ sources: [] }` rather than throwing or returning
// null/undefined for any input that is not a valid, populated
// `contextResult.fields` object (no report, no-data, a malformed shape) --
// an empty snapshot is a valid, honest result, never a fabricated one.
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
    // Per-section, not report-wide -- see resolveExplicitPeriod() above.
    // Currently always undefined; `period` remains correctly omitted.
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
