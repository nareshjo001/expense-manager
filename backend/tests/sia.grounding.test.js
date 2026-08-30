// Batch 3F: unit tests for backend/sia/groundingService.js in isolation --
// no HTTP layer, no app, no mocking framework beyond plain function calls.
// Complements backend/tests/sia.ask.groundingTransparency.test.js, which
// proves the same rules end-to-end through POST /sia/ask.
"use strict";

const { buildGroundingSnapshot, GROUNDING_SOURCE_ALLOWLIST } = require("../sia/groundingService");

describe("sia/groundingService -- buildGroundingSnapshot()", () => {
  it("returns an empty sources array for a null/undefined contextResult", () => {
    expect(buildGroundingSnapshot(null)).toEqual({ sources: [] });
    expect(buildGroundingSnapshot(undefined)).toEqual({ sources: [] });
  });

  it("returns an empty sources array when fields is null (the no-data shape)", () => {
    expect(buildGroundingSnapshot({ intent: "HEALTH_EXPLANATION", fields: null, reason: "no_data" })).toEqual({
      sources: [],
    });
  });

  it("returns an empty sources array when fields is not a plain object", () => {
    expect(buildGroundingSnapshot({ fields: [] })).toEqual({ sources: [] });
    expect(buildGroundingSnapshot({ fields: "not an object" })).toEqual({ sources: [] });
  });

  it("includes exactly one allowlisted source for a single-field context, with the correct key and label", () => {
    const result = buildGroundingSnapshot({
      fields: { financialHealth: { overall: 75 } },
      sourceReportGeneratedAt: "2026-08-09T00:00:00.000Z",
    });
    // sourceReportGeneratedAt is the report's generation timestamp, not this
    // section's reporting period -- it must never appear as `period` (see
    // resolveExplicitPeriod() in groundingService.js).
    expect(result.sources).toEqual([{ key: "financialHealth", label: "Financial health analysis" }]);
  });

  it("includes every allowlisted field actually present, in fixed canonical order, regardless of the object's own key order", () => {
    const result = buildGroundingSnapshot({
      // Deliberately reverse insertion order vs. the canonical allowlist.
      fields: { summary: { totalSpent: 100 }, trends: { monthlyTrend: {} } },
      sourceReportGeneratedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(result.sources.map((s) => s.key)).toEqual(["summary", "trends"]);
  });

  it("never lists a field that is present in the allowlist but absent from this context's fields", () => {
    const result = buildGroundingSnapshot({
      fields: { budget: { hasBudget: true } },
      sourceReportGeneratedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].key).toBe("budget");
    // Nothing else in the allowlist is fabricated.
    const otherKeys = GROUNDING_SOURCE_ALLOWLIST.map((e) => e.key).filter((k) => k !== "budget");
    for (const key of otherKeys) {
      expect(result.sources.find((s) => s.key === key)).toBeUndefined();
    }
  });

  it("excludes a field explicitly present as null or undefined -- not a real value", () => {
    const result = buildGroundingSnapshot({
      fields: { financialHealth: null, trends: undefined, risk: { hasData: true } },
      sourceReportGeneratedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(result.sources.map((s) => s.key)).toEqual(["risk"]);
  });

  it("ignores an unrecognized field key -- never invents an entry outside the allowlist", () => {
    const result = buildGroundingSnapshot({
      fields: { someFutureSection: { x: 1 }, risk: { hasData: true } },
    });
    expect(result.sources).toEqual([{ key: "risk", label: "Financial risk signals" }]);
  });

  it("CURRENT_SPENDING_SUMMARY's bounded context produces exactly the summary source and nothing else", () => {
    const result = buildGroundingSnapshot({
      intent: "CURRENT_SPENDING_SUMMARY",
      fields: { summary: { totalSpent: 1234.56 } },
      sourceReportGeneratedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(result).toEqual({ sources: [{ key: "summary", label: "Financial summary" }] });
    // No raw transaction/category/trend/budget/anomaly/forecast/risk source.
    expect(result.sources).toHaveLength(1);
  });

  it("deduplicates -- the allowlist itself has no duplicate keys, and each field is visited at most once", () => {
    const keys = GROUNDING_SOURCE_ALLOWLIST.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never derives period from sourceReportGeneratedAt -- that field is a generation timestamp, not a reporting period", () => {
    // Regression for the Batch 3F acceptance defect: an earlier version of
    // this module relabelled sourceReportGeneratedAt as every source's
    // `period`. That was factually wrong and has been removed. Since no
    // allowlisted section currently exposes its own authoritative period
    // field, `period` must be omitted regardless of what
    // sourceReportGeneratedAt is set to.
    const result = buildGroundingSnapshot({
      fields: { anomalies: { hasData: true }, forecast: { hasData: true } },
      sourceReportGeneratedAt: "2026-01-15T08:30:00.000Z",
    });
    expect(result.sources.every((s) => !("period" in s))).toBe(true);
  });

  it("omits period entirely (never guesses, never infers from the current date) regardless of sourceReportGeneratedAt's value or shape", () => {
    const missing = buildGroundingSnapshot({ fields: { risk: { hasData: true } } });
    expect(missing.sources[0]).not.toHaveProperty("period");

    const present = buildGroundingSnapshot({
      fields: { risk: { hasData: true } },
      sourceReportGeneratedAt: "2026-08-09T00:00:00.000Z",
    });
    expect(present.sources[0]).not.toHaveProperty("period");

    const malformed = buildGroundingSnapshot({
      fields: { risk: { hasData: true } },
      sourceReportGeneratedAt: "not-a-date",
    });
    expect(malformed.sources[0]).not.toHaveProperty("period");

    const wrongType = buildGroundingSnapshot({
      fields: { risk: { hasData: true } },
      sourceReportGeneratedAt: 12345,
    });
    expect(wrongType.sources[0]).not.toHaveProperty("period");
  });

  it("every source object currently contains only key and label -- no raw data, no extra fields, no period until a section provides one", () => {
    const result = buildGroundingSnapshot({
      fields: {
        categories: {
          topCategory: { category: "Food", total: 500 },
          categoryDistribution: [{ category: "Food", amount: 500, percentage: 100 }],
        },
      },
      sourceReportGeneratedAt: "2026-08-09T00:00:00.000Z",
    });
    expect(result.sources).toHaveLength(1);
    expect(Object.keys(result.sources[0]).sort()).toEqual(["key", "label"]);
    const serialized = JSON.stringify(result.sources);
    // No raw category name, amount, or percentage from the context ever
    // reaches the snapshot.
    expect(serialized).not.toContain("Food");
    expect(serialized).not.toContain("500");
  });

  it("real seven-intent context shapes each resolve to their expected canonical source set", () => {
    expect(
      buildGroundingSnapshot({ fields: { financialHealth: {}, summary: { healthScore: 1 } } }).sources.map(
        (s) => s.key
      )
    ).toEqual(["financialHealth", "summary"]);

    expect(
      buildGroundingSnapshot({ fields: { trends: {}, summary: { totalSpent: 1 } } }).sources.map((s) => s.key)
    ).toEqual(["summary", "trends"]);

    expect(buildGroundingSnapshot({ fields: { budget: {} } }).sources.map((s) => s.key)).toEqual(["budget"]);
    expect(buildGroundingSnapshot({ fields: { categories: {} } }).sources.map((s) => s.key)).toEqual(["categories"]);
    expect(buildGroundingSnapshot({ fields: { anomalies: {} } }).sources.map((s) => s.key)).toEqual(["anomalies"]);
    expect(buildGroundingSnapshot({ fields: { forecast: {} } }).sources.map((s) => s.key)).toEqual(["forecast"]);
    expect(
      buildGroundingSnapshot({ fields: { risk: {}, summary: { totalSpent: 1, budgetStatus: "ok" } } }).sources.map(
        (s) => s.key
      )
    ).toEqual(["summary", "risk"]);
  });
});
