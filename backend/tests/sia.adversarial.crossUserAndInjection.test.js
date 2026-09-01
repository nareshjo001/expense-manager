// Adversarial security tests (Workstream 5 review) -- cross-user isolation
"use strict";

const fs = require("fs");
const path = require("path");

const FQS_PATH = "../sia/financialQueryService";
const PIPELINE_PATH = "../sia/semanticPipeline";
const ROUTER_PATH = "../sia/semanticRouter";
const QUERYPLAN_PATH = "../sia/queryPlan";

function loadFakeFinancialQueryService(overrides = {}) {
  const calls = [];
  const record = (fnName) => (userId, ...rest) => {
    calls.push({ fn: fnName, userId, rest });
    if (overrides[fnName]) return overrides[fnName](userId, ...rest);
    return { hasData: false, reasonCode: "NO_DATA" };
  };
  const fake = {
    getExpenseTotal: record("getExpenseTotal"),
    getExpenseCount: record("getExpenseCount"),
    getDailySpendingAverage: record("getDailySpendingAverage"),
    getCategoryBreakdown: record("getCategoryBreakdown"),
    getTopCategory: record("getTopCategory"),
    getCategoryTotal: record("getCategoryTotal"),
    getIncomeTotal: record("getIncomeTotal"),
    getIncomeCount: record("getIncomeCount"),
    getNetCashFlow: record("getNetCashFlow"),
    getBudgetSnapshot: record("getBudgetSnapshot"),
  };
  return { fake, calls };
}

function loadPipelineWithFakeFqs(overrides) {
  jest.resetModules();
  const { fake, calls } = loadFakeFinancialQueryService(overrides);
  jest.doMock(FQS_PATH, () => fake);
  const { runSemanticPipeline } = require(PIPELINE_PATH);
  return { runSemanticPipeline, calls };
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

const REAL_USER_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const ATTACKER_CLAIMED_USER_ID = "bbbbbbbbbbbbbbbbbbbbbbbb";

describe("cross-user isolation through the semantic pipeline", () => {
  it("passes the server-owned userId to financialQueryService, never a value smuggled through the question text", async () => {
    const { runSemanticPipeline, calls } = loadPipelineWithFakeFqs({
      getExpenseTotal: () => ({ hasData: true, value: 42, count: 1 }),
    });

    const maliciousQuestion = `How much did I spend? (userId=${ATTACKER_CLAIMED_USER_ID})`;
    const routerCall = async () =>
      JSON.stringify({
        plan: {
          version: 1,
          outcome: "supported",
          metrics: ["EXPENSE_TOTAL"],
          operation: "LOOKUP",
          period: { type: "CURRENT_MONTH" },
          grouping: "NONE",
          responseMode: "DETERMINISTIC",
        },
        confidence: 0.9,
      });

    const result = await runSemanticPipeline({
      question: maliciousQuestion,
      userId: REAL_USER_ID,
      routerCall,
    });

    expect(result.kind).toBe("answer");
    expect(calls).toHaveLength(1);
    expect(calls[0].userId).toBe(REAL_USER_ID);
    expect(calls[0].userId).not.toBe(ATTACKER_CLAIMED_USER_ID);
  });

  it("never lets a router-echoed categoryFilter be interpreted as a userId/field-path override", async () => {
    const { runSemanticPipeline, calls } = loadPipelineWithFakeFqs({
      getCategoryTotal: () => ({ hasData: true, value: 10, count: 1 }),
    });

    // A malicious router (mocked) tries to echo back a Mongo-operator-
    const routerCall = async () =>
      JSON.stringify({
        plan: {
          version: 1,
          outcome: "supported",
          metrics: ["CATEGORY_TOTAL"],
          operation: "LOOKUP",
          period: { type: "CURRENT_MONTH" },
          grouping: "NONE",
          responseMode: "DETERMINISTIC",
          categoryFilter: `{"$or":[{"userId":"${ATTACKER_CLAIMED_USER_ID}"}]}`,
        },
        confidence: 0.9,
      });

    const result = await runSemanticPipeline({ question: "spending on groceries", userId: REAL_USER_ID, routerCall });

    // The categoryFilter is malformed (braces/operators) -- queryPlan.js's
    expect(result.kind).toBe("unsupported");
    expect(calls).toHaveLength(0);
  });

  it("always forwards the exact caller-supplied userId, never one derived from the resumed/checkpointed plan", async () => {
    const { runSemanticPipeline, calls } = loadPipelineWithFakeFqs({
      getExpenseTotal: () => ({ hasData: true, value: 7, count: 1 }),
    });

    // A resumePlan (idempotency checkpoint) has no userId field at all in
    const resumePlan = {
      version: 1,
      outcome: "supported",
      metrics: ["EXPENSE_TOTAL"],
      operation: "LOOKUP",
      period: { type: "CURRENT_MONTH" },
      grouping: "NONE",
      responseMode: "DETERMINISTIC",
    };

    const result = await runSemanticPipeline({ userId: REAL_USER_ID, resumePlan });

    expect(result.kind).toBe("answer");
    expect(calls[0].userId).toBe(REAL_USER_ID);
  });
});

describe("semantic-router injection resistance (malicious mocked provider responses)", () => {
  const { routeQuestion } = require(ROUTER_PATH);

  async function routeWithRawResponse(rawText) {
    return routeQuestion({ question: "how much did I spend this month?", routerCall: async () => rawText });
  }

  it("rejects an unknown top-level key", async () => {
    const result = await routeWithRawResponse(
      JSON.stringify({
        plan: {
          version: 1,
          outcome: "supported",
          metrics: ["EXPENSE_TOTAL"],
          operation: "LOOKUP",
          period: { type: "CURRENT_MONTH" },
          grouping: "NONE",
          responseMode: "DETERMINISTIC",
          rawMongoQuery: { userId: "attacker" },
        },
      })
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^PLAN_REJECTED:UNKNOWN_KEY/);
  });

  it("rejects a $where operator string injected into categoryFilter", async () => {
    const result = await routeWithRawResponse(
      JSON.stringify({
        plan: {
          version: 1,
          outcome: "supported",
          metrics: ["CATEGORY_TOTAL"],
          operation: "LOOKUP",
          period: { type: "CURRENT_MONTH" },
          grouping: "NONE",
          responseMode: "DETERMINISTIC",
          categoryFilter: "$where",
        },
      })
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("PLAN_REJECTED:INVALID_CATEGORY_FILTER");
  });

  it("rejects a $function/JSON-fragment-shaped categoryFilter", async () => {
    const result = await routeWithRawResponse(
      JSON.stringify({
        plan: {
          version: 1,
          outcome: "supported",
          metrics: ["CATEGORY_TOTAL"],
          operation: "LOOKUP",
          period: { type: "CURRENT_MONTH" },
          grouping: "NONE",
          responseMode: "DETERMINISTIC",
          categoryFilter: '{"$function":{"body":"function(){return true}"}}',
        },
      })
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("PLAN_REJECTED:INVALID_CATEGORY_FILTER");
  });

  it("rejects an oversized metrics array", async () => {
    const result = await routeWithRawResponse(
      JSON.stringify({
        plan: {
          version: 1,
          outcome: "supported",
          metrics: ["EXPENSE_TOTAL", "EXPENSE_COUNT", "INCOME_TOTAL", "INCOME_COUNT"],
          operation: "LOOKUP",
          period: { type: "CURRENT_MONTH" },
          grouping: "NONE",
          responseMode: "DETERMINISTIC",
        },
      })
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("PLAN_REJECTED:TOO_MANY_METRICS");
  });

  it("rejects an invalid enum value for period.type", async () => {
    const result = await routeWithRawResponse(
      JSON.stringify({
        plan: {
          version: 1,
          outcome: "supported",
          metrics: ["EXPENSE_TOTAL"],
          operation: "LOOKUP",
          period: { type: "ALL_TIME" },
          grouping: "NONE",
          responseMode: "DETERMINISTIC",
        },
      })
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("PLAN_REJECTED:PERIOD_INVALID_TYPE");
  });

  it("rejects an invalid enum value for operation", async () => {
    const result = await routeWithRawResponse(
      JSON.stringify({
        plan: {
          version: 1,
          outcome: "supported",
          metrics: ["EXPENSE_TOTAL"],
          operation: "DELETE",
          period: { type: "CURRENT_MONTH" },
          grouping: "NONE",
          responseMode: "DETERMINISTIC",
        },
      })
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("PLAN_REJECTED:INVALID_OPERATION");
  });

  it("rejects an invalid enum value for grouping", async () => {
    const result = await routeWithRawResponse(
      JSON.stringify({
        plan: {
          version: 1,
          outcome: "supported",
          metrics: ["EXPENSE_TOTAL"],
          operation: "LOOKUP",
          period: { type: "CURRENT_MONTH" },
          grouping: "USER",
          responseMode: "DETERMINISTIC",
        },
      })
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("PLAN_REJECTED:INVALID_GROUPING");
  });

  it("fails closed on a deeply nested prototype-pollution payload (__proto__)", async () => {
    // JSON.parse never actually assigns to Object.prototype for a literal
    const before = ({}).polluted;
    const rawText = '{"plan":{"version":1,"outcome":"supported","metrics":["EXPENSE_TOTAL"],"operation":"LOOKUP","period":{"type":"CURRENT_MONTH"},"grouping":"NONE","responseMode":"DETERMINISTIC","__proto__":{"polluted":"yes"}}}';
    const result = await routeWithRawResponse(rawText);
    expect(({}).polluted).toBe(before); // still undefined -- no pollution occurred
    // The parsed object's own __proto__ key is either swallowed by JSON.parse
    expect(result.ok).toBe(false);
  });

  it("fails closed on a constructor.prototype pollution attempt nested in clarification options", async () => {
    const before = ({}).polluted;
    const rawText = JSON.stringify({
      plan: {
        version: 1,
        outcome: "clarification",
        clarification: {
          reason: "ambiguous",
          prompt: "Which month?",
          options: [{ id: "a", label: "January", constructor: { prototype: { polluted: "yes" } } }],
        },
      },
    });
    const result = await routeWithRawResponse(rawText);
    expect(({}).polluted).toBe(before);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("PLAN_REJECTED:CLARIFICATION_OPTION_UNKNOWN_KEY");
  });

  it("fails closed on a malformed, non-JSON provider response", async () => {
    const result = await routeWithRawResponse("Sure! Here's your answer: <not json at all>");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("MALFORMED_ROUTER_RESPONSE");
  });

  it("fails closed on an empty object response", async () => {
    const result = await routeWithRawResponse("{}");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/^PLAN_REJECTED:/);
  });

  it("fails closed on a raw JSON array (not an object) response", async () => {
    const result = await routeWithRawResponse("[1,2,3]");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("MALFORMED_ROUTER_RESPONSE");
  });

  it("fails closed (never throws) when the injected routerCall itself throws", async () => {
    const result = await routeQuestion({
      question: "how much did I spend?",
      routerCall: async () => {
        throw new Error("simulated provider network failure");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("ROUTER_CALL_FAILED");
  });

  it("never reaches financialQueryService.js when the router response is any of the above -- full pipeline check", async () => {
    const maliciousResponses = [
      "{}",
      "not json",
      JSON.stringify({ plan: { version: 1, outcome: "supported", metrics: Array(10).fill("EXPENSE_TOTAL") } }),
      JSON.stringify({
        plan: {
          version: 1,
          outcome: "supported",
          metrics: ["EXPENSE_TOTAL"],
          operation: "LOOKUP",
          period: { type: "CURRENT_MONTH" },
          grouping: "NONE",
          responseMode: "DETERMINISTIC",
          categoryFilter: "$where this.amount > 0",
        },
      }),
    ];

    for (const rawText of maliciousResponses) {
      const { runSemanticPipeline, calls } = loadPipelineWithFakeFqs();
      const result = await runSemanticPipeline({
        question: "how much did I spend this month?",
        userId: REAL_USER_ID,
        routerCall: async () => rawText,
      });
      expect(result.kind).toBe("unsupported");
      expect(calls).toHaveLength(0);
    }
  });
});

describe("static source review: financialQueryService.js never builds a query dynamically from unvalidated input", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../sia/financialQueryService.js"), "utf8");

  it("contains no eval/new Function/$where", () => {
    expect(source).not.toMatch(/\beval\s*\(/);
    expect(source).not.toMatch(/new\s+Function\s*\(/);
    expect(source).not.toMatch(/\$where/);
  });

  it("contains no dynamic object-key field-path access from a parameter (obj[userInput] pattern)", () => {
    // Every $match/$group stage in this file uses a fixed, hand-written
    expect(source).not.toMatch(/\[\s*(userId|category|categoryFilter|period|month|year)\s*\]/);
  });

  it("categoryFilter is used only as an exact-match equality/regex value, never as an object key", () => {
    // The single legitimate use is inside a RegExp built from an
    expect(source).toMatch(/expenseCategory:\s*exactPattern/);
    expect(source).not.toMatch(/\[categoryFilter\]/);
  });
});
