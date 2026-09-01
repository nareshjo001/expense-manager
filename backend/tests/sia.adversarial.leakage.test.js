// Adversarial security tests (Workstream 5 review) -- raw-data / internal-
"use strict";

const { validateGroundedAnswer, validateCitedAnswer } = require("../sia/responseValidator");
const { buildGroundingSnapshot, GROUNDING_SOURCE_ALLOWLIST } = require("../sia/groundingService");
const { buildFact, createFactSetBuilder, validateFactSet } = require("../sia/factSet");

describe("adversarial: a maliciously-crafted LLM answer combining an ObjectId, a leaked field token, and JSON-shaped output", () => {
  const contextFields = {
    financialHealth: { overall: 70, risk: { label: "Low", color: "green" } },
  };

  it("validateGroundedAnswer rejects a fake ObjectId + fake internal field name combined in one answer (HEALTH_EXPLANATION)", () => {
    const maliciousAnswer =
      'Your health score is 70. For reference, expense 65b1f9e2a4d3c2f1a9e8d7c6 (userId 65b1f9e2a4d3c2f1a9e8d7c7) was included, and "recentExpensePool": [ ... ].';

    const result = validateGroundedAnswer({
      intent: "HEALTH_EXPLANATION",
      answer: maliciousAnswer,
      contextFields,
    });

    expect(result.valid).toBe(false);
    // The FIRST check in validateGroundedAnswer's ordered pipeline (Mongo
    expect(result.reasonCode).toBe("LEAKED_IDENTIFIER");
  });

  it("validateGroundedAnswer rejects the SAME payload even with the ObjectId removed (raw field token alone is enough)", () => {
    const maliciousAnswer = 'Your health score is 70. Debug info: "recentExpensePool" had 12 entries and userId was attached.';
    const result = validateGroundedAnswer({
      intent: "HEALTH_EXPLANATION",
      answer: maliciousAnswer,
      contextFields,
    });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("RAW_FIELD_LEAKAGE");
  });

  it("validateCitedAnswer (FactSet path) rejects the same fake ObjectId + raw field token combination", () => {
    const factSet = {
      facts: [
        {
          factId: "fact-1",
          metric: "EXPENSE_TOTAL",
          value: 4250,
          unit: "INR",
          source: "EXPENSE",
        },
      ],
    };
    const maliciousAnswer = "You spent ₹4250. Internal ref: 65b1f9e2a4d3c2f1a9e8d7c6, baseline recalculated.";
    const result = validateCitedAnswer({
      answer: maliciousAnswer,
      citedFactIds: ["fact-1"],
      factSet,
      plan: { operation: "LOOKUP", metrics: ["EXPENSE_TOTAL"] },
    });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("LEAKED_IDENTIFIER");
  });

  it.each([
    "_sortMultiple", "recentExpensePool", "currentMonthExpenses", "forecastMonthlySeries", "userId", "_id", "baseline",
  ])("validateGroundedAnswer rejects every documented raw field token in isolation: %s", (token) => {
    const result = validateGroundedAnswer({
      intent: "HEALTH_EXPLANATION",
      answer: `Your health score is 70. (debug token: ${token})`,
      contextFields,
    });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("RAW_FIELD_LEAKAGE");
  });
});

describe("FIXED: general-purpose leaked-transaction-detail check now applies outside CURRENT_SPENDING_SUMMARY / validateCitedAnswer", () => {
  // responseValidator.js's SUMMARY_TRANSACTION_DETAIL_PATTERN (which
  it("rejects a fabricated merchant name in an ANOMALY_EXPLANATION answer (fix confirmed)", () => {
    const contextFields = {
      anomalies: { flaggedExpenses: [{ expenseId: "abc", category: "Dining", amount: 500, expenseDate: "2026-08-01" }] },
    };
    const fabricatedAnswer =
      "This expense of ₹500 at Dining was flagged as unusual relative to your history, likely at Merchant XYZ based on your receipt.";
    const result = validateGroundedAnswer({
      intent: "ANOMALY_EXPLANATION",
      answer: fabricatedAnswer,
      contextFields,
    });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("UNSUPPORTED_TRANSACTION_DETAIL");
  });

  it("rejects a fabricated 'receipt'/'line item' claim in a FactSet-cited EXPLAIN answer (fix confirmed)", () => {
    const factSet = { facts: [{ factId: "fact-1", metric: "CATEGORY_TOTAL", value: 500, unit: "INR", source: "EXPENSE" }] };
    const fabricatedAnswer = "You spent ₹500 on Dining, based on a receipt from a nearby restaurant.";
    const result = validateCitedAnswer({
      answer: fabricatedAnswer,
      citedFactIds: ["fact-1"],
      factSet,
      plan: { operation: "LOOKUP", metrics: ["CATEGORY_TOTAL"] },
    });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("UNSUPPORTED_TRANSACTION_DETAIL");
  });

  it("confirms the SAME transaction-detail language IS rejected for CURRENT_SPENDING_SUMMARY (the one intent it's wired for)", () => {
    const result = validateGroundedAnswer({
      intent: "CURRENT_SPENDING_SUMMARY",
      answer: "You have spent ₹4250 so far this month, mostly at one merchant.",
      contextFields: { summary: { totalSpent: 4250 } },
    });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("UNSUPPORTED_TRANSACTION_DETAIL");
  });
});

describe("groundingService.js allowlist ignores injected malicious keys", () => {
  it("never includes an unrecognized/malicious top-level field key in the grounding snapshot", () => {
    const maliciousContextResult = {
      fields: {
        financialHealth: { overall: 70 },
        // Attacker/bug-injected keys that are NOT on the allowlist --
        // must never surface as a "source".
        rawExpenses: [{ _id: "65b1f9e2a4d3c2f1a9e8d7c6", amount: 500 }],
        userId: "65b1f9e2a4d3c2f1a9e8d7c7",
        __proto__: { polluted: true },
      },
    };
    const snapshot = buildGroundingSnapshot(maliciousContextResult);
    const keys = snapshot.sources.map((s) => s.key);
    expect(keys).toEqual(["financialHealth"]);
    expect(keys).not.toContain("rawExpenses");
    expect(keys).not.toContain("userId");
    // Every key in the snapshot is drawn only from the fixed allowlist.
    const allowlistKeys = new Set(GROUNDING_SOURCE_ALLOWLIST.map((e) => e.key));
    for (const k of keys) expect(allowlistKeys.has(k)).toBe(true);
  });

  it("returns an empty, safe snapshot for a completely malformed contextResult", () => {
    expect(buildGroundingSnapshot(null)).toEqual({ sources: [] });
    expect(buildGroundingSnapshot(undefined)).toEqual({ sources: [] });
    expect(buildGroundingSnapshot({})).toEqual({ sources: [] });
    expect(buildGroundingSnapshot({ fields: "not-an-object" })).toEqual({ sources: [] });
    expect(buildGroundingSnapshot({ fields: ["array", "not", "object"] })).toEqual({ sources: [] });
  });
});

describe("factSet.js buildFact() strips any extra/malicious key from a malicious spec object", () => {
  it("never copies through an extra field (e.g. a fake _id/merchant) present on the input spec", () => {
    const maliciousSpec = {
      metric: "EXPENSE_TOTAL",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-09-01T00:00:00.000Z"),
      periodLabel: "this month",
      value: 4250,
      unit: "INR",
      source: "EXPENSE",
      // Attacker/bug-injected extras -- buildFact() only reads the named
      // destructured fields, so these must never appear on the output.
      _id: "65b1f9e2a4d3c2f1a9e8d7c6",
      merchant: "Some Store",
      userId: "65b1f9e2a4d3c2f1a9e8d7c7",
    };
    const builder = createFactSetBuilder();
    const result = builder.add(maliciousSpec);
    expect(result.ok).toBe(true);
    const fact = result.fact;
    expect(fact._id).toBeUndefined();
    expect(fact.merchant).toBeUndefined();
    expect(fact.userId).toBeUndefined();
    expect(Object.keys(fact).sort()).toEqual(
      ["factId", "isEstimate", "metric", "periodStart", "periodEnd", "periodLabel", "source", "unit", "value"].sort()
    );
  });

  it("rejects an invalid/unsupported metric enum rather than passing it through", () => {
    const result = buildFact({
      factId: "fact-1",
      metric: "RAW_TRANSACTION_LIST", // not a member of queryPlan.js's METRICS allowlist
      periodStart: new Date(),
      periodEnd: new Date(),
      periodLabel: "this month",
      value: 100,
      unit: "INR",
      source: "EXPENSE",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("INVALID_METRIC");
  });

  it("rejects a bounded-size violation (FACT_SET_FULL) rather than growing unbounded", () => {
    const builder = createFactSetBuilder();
    for (let i = 0; i < 30; i += 1) {
      const r = builder.add({
        metric: "EXPENSE_TOTAL",
        periodStart: new Date(),
        periodEnd: new Date(),
        periodLabel: "this month",
        value: i,
        unit: "INR",
        source: "EXPENSE",
      });
      expect(r.ok).toBe(true);
    }
    const overflow = builder.add({
      metric: "EXPENSE_TOTAL",
      periodStart: new Date(),
      periodEnd: new Date(),
      periodLabel: "this month",
      value: 999,
      unit: "INR",
      source: "EXPENSE",
    });
    expect(overflow.ok).toBe(false);
    expect(overflow.reason).toBe("FACT_SET_FULL");
  });

  it("validateFactSet rejects a maliciously reconstructed FactSet with a duplicate factId", () => {
    const result = validateFactSet({
      facts: [
        { factId: "fact-1", metric: "EXPENSE_TOTAL", unit: "INR", source: "EXPENSE" },
        { factId: "fact-1", metric: "INCOME_TOTAL", unit: "INR", source: "INCOME" },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("DUPLICATE_FACT_ID");
  });
});
