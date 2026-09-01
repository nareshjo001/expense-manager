// SIA FactSet -- a small, typed, bounded collection of individual facts
"use strict";

const { METRICS } = require("./queryPlan");

const UNITS = Object.freeze(["INR", "COUNT", "PERCENT", "RATIO"]);

const SOURCES = Object.freeze(["EXPENSE", "INCOME", "BUDGET", "DERIVED"]);

const MAX_FACTS_PER_SET = 30;
const MAX_GROUP_KEY_LENGTH = 60;
const MAX_REASON_CODE_LENGTH = 60;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/* Validates and normalizes a single fact's shape. Returns */
function buildFact({ factId, metric, periodStart, periodEnd, periodLabel, value, unit, source, groupKey, isEstimate, reasonCode }) {
  if (typeof factId !== "string" || factId.trim() === "") return { ok: false, reason: "INVALID_FACT_ID" };
  if (!METRICS.includes(metric)) return { ok: false, reason: "INVALID_METRIC" };
  if (!(periodStart instanceof Date) || Number.isNaN(periodStart.getTime())) {
    return { ok: false, reason: "INVALID_PERIOD_START" };
  }
  if (!(periodEnd instanceof Date) || Number.isNaN(periodEnd.getTime())) {
    return { ok: false, reason: "INVALID_PERIOD_END" };
  }
  if (typeof periodLabel !== "string" || periodLabel.trim() === "") return { ok: false, reason: "INVALID_PERIOD_LABEL" };
  // A fact's value is either a finite number or (for a genuinely absent
  if (value !== null && !isFiniteNumber(value)) return { ok: false, reason: "INVALID_VALUE" };
  if (!UNITS.includes(unit)) return { ok: false, reason: "INVALID_UNIT" };
  if (!SOURCES.includes(source)) return { ok: false, reason: "INVALID_SOURCE" };
  if (groupKey !== undefined && groupKey !== null) {
    if (typeof groupKey !== "string" || groupKey.length === 0 || groupKey.length > MAX_GROUP_KEY_LENGTH) {
      return { ok: false, reason: "INVALID_GROUP_KEY" };
    }
  }
  if (reasonCode !== undefined && reasonCode !== null) {
    if (typeof reasonCode !== "string" || reasonCode.length === 0 || reasonCode.length > MAX_REASON_CODE_LENGTH) {
      return { ok: false, reason: "INVALID_REASON_CODE" };
    }
  }

  const fact = {
    factId,
    metric,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    periodLabel,
    value,
    unit,
    source,
  };
  if (groupKey !== undefined && groupKey !== null) fact.groupKey = groupKey;
  fact.isEstimate = isEstimate === true;
  if (reasonCode !== undefined && reasonCode !== null) fact.reasonCode = reasonCode;

  return { ok: true, fact };
}

/* A small builder that assigns stable, sequential, set-scoped fact IDs */
function createFactSetBuilder() {
  const facts = [];
  let counter = 0;

  return {
    add(spec) {
      if (facts.length >= MAX_FACTS_PER_SET) {
        return { ok: false, reason: "FACT_SET_FULL" };
      }
      counter += 1;
      const factId = `fact-${counter}`;
      const result = buildFact({ ...spec, factId });
      if (!result.ok) return result;
      facts.push(result.fact);
      return { ok: true, fact: result.fact };
    },
    build() {
      return Object.freeze({ facts: facts.slice() });
    },
  };
}

/* Validates a fully-formed FactSet object (e.g. one reconstructed from */
function validateFactSet(factSet) {
  try {
    if (!isPlainObject(factSet) || !Array.isArray(factSet.facts)) {
      return { valid: false, reason: "INVALID_FACT_SET" };
    }
    if (factSet.facts.length > MAX_FACTS_PER_SET) {
      return { valid: false, reason: "TOO_MANY_FACTS" };
    }
    const seenIds = new Set();
    for (const fact of factSet.facts) {
      if (!isPlainObject(fact) || typeof fact.factId !== "string") {
        return { valid: false, reason: "INVALID_FACT" };
      }
      if (seenIds.has(fact.factId)) return { valid: false, reason: "DUPLICATE_FACT_ID" };
      seenIds.add(fact.factId);
      if (!METRICS.includes(fact.metric)) return { valid: false, reason: "INVALID_FACT_METRIC" };
      if (!UNITS.includes(fact.unit)) return { valid: false, reason: "INVALID_FACT_UNIT" };
      if (!SOURCES.includes(fact.source)) return { valid: false, reason: "INVALID_FACT_SOURCE" };
    }
    return { valid: true };
  } catch (_err) {
    return { valid: false, reason: "INTERNAL_VALIDATION_ERROR" };
  }
}

function findFactById(factSet, factId) {
  if (!isPlainObject(factSet) || !Array.isArray(factSet.facts)) return null;
  return factSet.facts.find((f) => f && f.factId === factId) || null;
}

module.exports = {
  UNITS,
  SOURCES,
  MAX_FACTS_PER_SET,
  buildFact,
  createFactSetBuilder,
  validateFactSet,
  findFactById,
};
