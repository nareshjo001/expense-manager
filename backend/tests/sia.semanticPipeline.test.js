// Unit tests for backend/sia/semanticPipeline.js -- the orchestration
"use strict";

const { runSemanticPipeline } = require("../sia/semanticPipeline");

const NOW = new Date("2026-08-16T10:00:00.000Z");

function jsonRouterCall(plan, confidence = 0.9) {
  return jest.fn(async () => JSON.stringify({ plan, confidence }));
}

const lookupPlan = {
  version: 1,
  outcome: "supported",
  metrics: ["EXPENSE_TOTAL"],
  operation: "LOOKUP",
  period: { type: "CURRENT_MONTH" },
  grouping: "NONE",
  responseMode: "DETERMINISTIC",
};

const explainPlan = {
  version: 1,
  outcome: "supported",
  metrics: ["NET_CASH_FLOW"],
  operation: "EXPLAIN",
  period: { type: "CURRENT_MONTH" },
  grouping: "NONE",
  responseMode: "PROSE",
};

const explanationIntentPlan = {
  version: 1,
  outcome: "supported",
  metrics: ["HEALTH_EXPLANATION"],
  operation: "EXPLAIN",
  period: { type: "CURRENT_MONTH" },
  grouping: "NONE",
  responseMode: "PROSE",
};

function fakeFinancialQueryService(overrides = {}) {
  return {
    getExpenseTotal: jest.fn(async () => ({ hasData: true, value: 4250, count: 3 })),
    getExpenseCount: jest.fn(async () => ({ hasData: true, value: 3 })),
    getDailySpendingAverage: jest.fn(async () => ({ hasData: true, value: 100 })),
    getCategoryTotal: jest.fn(async () => ({ hasData: true, value: 500, count: 2 })),
    getCategoryBreakdown: jest.fn(async () => ({ hasData: true, categories: [{ category: "Groceries", total: 500, count: 2 }] })),
    getTopCategory: jest.fn(async () => ({ hasData: true, category: { category: "Groceries", total: 500 } })),
    getIncomeTotal: jest.fn(async () => ({ hasData: true, value: 10000, count: 1 })),
    getIncomeCount: jest.fn(async () => ({ hasData: true, value: 1 })),
    getNetCashFlow: jest.fn(async () => ({ hasData: true, value: 5750, incomeTotal: 10000, expenseTotal: 4250 })),
    getBudgetSnapshot: jest.fn(async () => ({ hasData: true, budget: 10000, spent: 4250, remaining: 5750, utilization: 42.5, status: "within_budget" })),
    executeFinancialQuery: jest.fn(async ({ query }) => {
      const resultByMetric = {
        EXPENSE_TOTAL: { hasData: true, value: 4250, count: 3 },
        INCOME_TOTAL: { hasData: true, value: 10000, count: 1 },
        NET_CASH_FLOW: { hasData: true, value: 5750, incomeTotal: 10000, expenseTotal: 4250 },
        CATEGORY_TOTAL: { hasData: true, value: 500, count: 2 },
      };
      return { ...(resultByMetric[query.metric] || { hasData: false, reasonCode: "UNSUPPORTED_METRIC" }), metric: query.metric };
    }),
    ...overrides,
  };
}

const multiLookupV2Plan = {
  version: 2,
  outcome: "supported",
  queries: [
    {
      metric: "CATEGORY_TOTAL",
      operation: "LOOKUP",
      period: { type: "CURRENT_MONTH" },
      grouping: "NONE",
      categoryFilter: "Food",
      responseMode: "DETERMINISTIC",
    },
    {
      metric: "INCOME_TOTAL",
      operation: "LOOKUP",
      period: { type: "CURRENT_MONTH" },
      grouping: "NONE",
      responseMode: "DETERMINISTIC",
    },
  ],
};

const v2ComparisonPlan = {
  version: 2,
  outcome: "supported",
  queries: [
    {
      metric: "EXPENSE_TOTAL",
      operation: "COMPARE",
      period: { type: "CURRENT_MONTH" },
      comparisonPeriod: { type: "PREVIOUS_MONTH" },
      grouping: "NONE",
      responseMode: "PROSE",
    },
  ],
};

const budgetOnTrackPlan = {
  version: 2,
  outcome: "supported",
  queries: [
    {
      metric: "BUDGET_STATUS",
      operation: "LOOKUP",
      period: { type: "CURRENT_MONTH" },
      grouping: "NONE",
      responseMode: "DETERMINISTIC",
    },
  ],
};

describe("backend/sia/semanticPipeline -- provider-call budgets", () => {
  it("routes the panel's natural-language budget prompt through the LLM plan, not an intent regex", async () => {
    const routerCall = jsonRouterCall(budgetOnTrackPlan);
    const financialQueryService = fakeFinancialQueryService({
      executeFinancialQuery: jest.fn(async ({ query }) => {
        expect(query.metric).toBe("BUDGET_STATUS");
        return { hasData: true, spent: 4250, status: "within_budget" };
      }),
    });

    const result = await runSemanticPipeline({
      question: "Am I on track with my budget?",
      userId: "user-1",
      now: NOW,
      routerCall,
      askLlmFn: jest.fn(),
      financialQueryService,
    });

    expect(routerCall).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe("answer");
    expect(result.answer).toContain("within budget");
    expect(result.providerCallsUsed).toEqual({ router: 1, answer: 0 });
  });

  it("scenario: semantic direct lookup = 1 router call + 0 answer calls (deterministic answer)", async () => {
    const routerCall = jsonRouterCall(lookupPlan);
    const askLlmFn = jest.fn();
    const financialQueryService = fakeFinancialQueryService();

    const result = await runSemanticPipeline({
      question: "How much did I spend this month?",
      userId: "user-1",
      now: NOW,
      routerCall,
      askLlmFn,
      financialQueryService,
    });

    expect(result.kind).toBe("answer");
    expect(result.providerCallsUsed).toEqual({ router: 1, answer: 0 });
    expect(routerCall).toHaveBeenCalledTimes(1);
    expect(askLlmFn).not.toHaveBeenCalled();
    expect(result.answer).toMatch(/₹4,250|Rs\.?\s?4,250|4,250\.00/);
  });

  it("scenario: semantic explanation = at most 1 router call + 1 answer call", async () => {
    const routerCall = jsonRouterCall(explainPlan);
    const askLlmFn = jest.fn(async () => ({
      answer: JSON.stringify({ answer: "Your net cash flow this month was ₹5750.", citedFactIds: ["fact-1"] }),
    }));
    const financialQueryService = fakeFinancialQueryService();

    const result = await runSemanticPipeline({
      question: "Explain my net cash flow this month",
      userId: "user-1",
      now: NOW,
      routerCall,
      askLlmFn,
      financialQueryService,
    });

    expect(result.kind).toBe("answer");
    expect(result.providerCallsUsed).toEqual({ router: 1, answer: 1 });
    expect(routerCall).toHaveBeenCalledTimes(1);
    expect(askLlmFn).toHaveBeenCalledTimes(1);
  });

  it("scenario: clearly prohibited request = 0 provider calls", async () => {
    const routerCall = jest.fn();
    const askLlmFn = jest.fn();

    const result = await runSemanticPipeline({
      question: "Please increase my budget to 50000",
      userId: "user-1",
      now: NOW,
      routerCall,
      askLlmFn,
      financialQueryService: fakeFinancialQueryService(),
    });

    expect(result.kind).toBe("unsupported");
    expect(result.providerCallsUsed).toEqual({ router: 0, answer: 0 });
    expect(routerCall).not.toHaveBeenCalled();
    expect(askLlmFn).not.toHaveBeenCalled();
  });

  it("scenario: no-data after a deterministic plan = 0 answer-generation calls", async () => {
    const routerCall = jsonRouterCall(lookupPlan);
    const askLlmFn = jest.fn();
    const financialQueryService = fakeFinancialQueryService({
      getExpenseTotal: jest.fn(async () => ({ hasData: false, reasonCode: "INVALID_USER_ID", value: null, count: 0 })),
    });

    const result = await runSemanticPipeline({
      question: "How much did I spend this month?",
      userId: "user-1",
      now: NOW,
      routerCall,
      askLlmFn,
      financialQueryService,
    });

    expect(result.kind).toBe("no_data");
    expect(result.providerCallsUsed).toEqual({ router: 1, answer: 0 });
    expect(askLlmFn).not.toHaveBeenCalled();
  });

  it("scenario: clarification = 0 answer-generation calls (router call did run, from the semantic path)", async () => {
    const clarificationPlan = {
      version: 1,
      outcome: "clarification",
      clarification: {
        reason: "AMBIGUOUS_MONTH",
        prompt: "Which year did you mean for March?",
        options: [
          { id: "2025-03", label: "March 2025" },
          { id: "2026-03", label: "March 2026" },
        ],
      },
    };
    const routerCall = jsonRouterCall(clarificationPlan);
    const askLlmFn = jest.fn();

    const result = await runSemanticPipeline({
      question: "How much did I spend in March?",
      userId: "user-1",
      now: NOW,
      routerCall,
      askLlmFn,
      financialQueryService: fakeFinancialQueryService(),
    });

    expect(result.kind).toBe("clarification");
    expect(result.providerCallsUsed).toEqual({ router: 1, answer: 0 });
    expect(routerCall).toHaveBeenCalledTimes(1);
    expect(askLlmFn).not.toHaveBeenCalled();
  });

  it("scenario: unsupported plan from router = 1 router call + 0 answer calls", async () => {
    const unsupportedPlan = { version: 1, outcome: "unsupported" };
    const routerCall = jsonRouterCall(unsupportedPlan);
    const askLlmFn = jest.fn();

    const result = await runSemanticPipeline({
      // Deliberately NOT a clearly-prohibited phrase (no mutation/raw-list/
      question: "How many pets do I have?",
      userId: "user-1",
      now: NOW,
      routerCall,
      askLlmFn,
      financialQueryService: fakeFinancialQueryService(),
    });

    expect(result.kind).toBe("unsupported");
    expect(result.providerCallsUsed).toEqual({ router: 1, answer: 0 });
    expect(askLlmFn).not.toHaveBeenCalled();
  });

  it("scenario: semantic plan resolving to an existing explanation intent delegates without reinventing it -- at most 1 router + 1 answer call", async () => {
    const routerCall = jsonRouterCall(explanationIntentPlan);
    const askLlmFn = jest.fn(); // must NOT be called directly by the pipeline itself
    const existingIntentHandler = jest.fn(async () => ({ payload: { success: true, answer: "..." }, usedAnswerCall: true }));

    const result = await runSemanticPipeline({
      question: "Why is my financial health score what it is?",
      userId: "user-1",
      now: NOW,
      routerCall,
      askLlmFn,
      financialQueryService: fakeFinancialQueryService(),
      existingIntentHandler,
    });

    expect(result.kind).toBe("explanation_intent_delegated");
    expect(result.providerCallsUsed).toEqual({ router: 1, answer: 1 });
    expect(existingIntentHandler).toHaveBeenCalledTimes(1);
    expect(existingIntentHandler).toHaveBeenCalledWith("HEALTH_EXPLANATION");
    // The pipeline itself must never call askLlm directly for a delegated
    // explanation intent -- that is the existing handler's job.
    expect(askLlmFn).not.toHaveBeenCalled();
  });

  it("deterministic direct lookup = 0 LLM calls even when a router mock is supplied but never invoked (prohibited path)", async () => {
    // Documents the deterministic-classifier floor's own budget for
    const routerCall = jest.fn();
    const result = await runSemanticPipeline({
      question: "List all my transactions",
      userId: "user-1",
      now: NOW,
      routerCall,
      askLlmFn: jest.fn(),
      financialQueryService: fakeFinancialQueryService(),
    });
    expect(result.providerCallsUsed).toEqual({ router: 0, answer: 0 });
  });
});

describe("backend/sia/semanticPipeline -- correctness beyond budgets", () => {
  it("executes a valid v2 multi-query plan through the allowlisted executor with no answer-model call", async () => {
    const routerCall = jsonRouterCall(multiLookupV2Plan);
    const askLlmFn = jest.fn();
    const financialQueryService = fakeFinancialQueryService();

    const result = await runSemanticPipeline({
      question: "How much did I spend on food and earn this month?",
      userId: "user-1",
      now: NOW,
      routerCall,
      askLlmFn,
      financialQueryService,
    });

    expect(result.kind).toBe("answer");
    expect(result.answer).toContain("Food");
    expect(result.answer).toContain("₹500");
    expect(result.answer).toContain("₹10,000");
    expect(result.providerCallsUsed).toEqual({ router: 1, answer: 0 });
    expect(result.planSummary).toEqual({
      metrics: ["CATEGORY_TOTAL", "INCOME_TOTAL"],
      operation: "MULTI_QUERY",
      periodLabel: expect.any(String),
      grouping: "NONE",
      categoryFilter: "Food",
    });
    expect(financialQueryService.executeFinancialQuery).toHaveBeenCalledTimes(2);
    expect(askLlmFn).not.toHaveBeenCalled();
  });

  it("fails closed when a v2 query cannot be executed, without an answer-model call", async () => {
    const financialQueryService = fakeFinancialQueryService({
      executeFinancialQuery: jest.fn(async () => ({ hasData: false, reasonCode: "INVALID_USER_ID" })),
    });

    const result = await runSemanticPipeline({
      question: "How much did I spend on food and earn this month?",
      userId: "user-1",
      now: NOW,
      routerCall: jsonRouterCall(multiLookupV2Plan),
      askLlmFn: jest.fn(),
      financialQueryService,
    });

    expect(result).toMatchObject({ kind: "no_data", reasonCode: "INVALID_USER_ID", providerCallsUsed: { router: 1, answer: 0 } });
  });

  it("uses one structured, cited answer call for a v2 comparison after both periods are factually executed", async () => {
    const askLlmFn = jest.fn(async () => ({
      structuredOutput: {
        answer: "Your spending was ₹4,250 this month, the same as last month.",
        citedFactIds: ["fact-1", "fact-2"],
      },
    }));
    const financialQueryService = fakeFinancialQueryService();

    const result = await runSemanticPipeline({
      question: "Compare my spending this month with last month",
      userId: "user-1",
      now: NOW,
      routerCall: jsonRouterCall(v2ComparisonPlan),
      askLlmFn,
      financialQueryService,
    });

    expect(result.kind).toBe("answer");
    expect(result.providerCallsUsed).toEqual({ router: 1, answer: 1 });
    expect(financialQueryService.executeFinancialQuery).toHaveBeenCalledTimes(2);
    expect(askLlmFn).toHaveBeenCalledWith(expect.objectContaining({ structuredOutput: expect.any(Object) }));
  });

  it("rejects a v2 prose answer whose amount is not present in its cited facts", async () => {
    const askLlmFn = jest.fn(async () => ({
      structuredOutput: { answer: "Your spending was ₹9,999 this month.", citedFactIds: ["fact-1", "fact-2"] },
    }));

    const result = await runSemanticPipeline({
      question: "Compare my spending this month with last month",
      userId: "user-1",
      now: NOW,
      routerCall: jsonRouterCall(v2ComparisonPlan),
      askLlmFn,
      financialQueryService: fakeFinancialQueryService(),
    });

    expect(result).toMatchObject({ kind: "unsupported", reasonCode: "GROUNDING_UNSUPPORTED_MONETARY_FIGURE" });
  });

  it("resumes a v2 checkpoint without another router call", async () => {
    const routerCall = jest.fn();
    const financialQueryService = fakeFinancialQueryService();

    const result = await runSemanticPipeline({
      question: "How much did I spend on food and earn this month?",
      userId: "user-1",
      now: NOW,
      routerCall,
      askLlmFn: jest.fn(),
      financialQueryService,
      resumePlan: multiLookupV2Plan,
    });

    expect(result.kind).toBe("answer");
    expect(result.providerCallsUsed).toEqual({ router: 0, answer: 0 });
    expect(routerCall).not.toHaveBeenCalled();
  });

  it("rejects a semantic-explanation answer whose citations don't validate, without a second provider call", async () => {
    const routerCall = jsonRouterCall(explainPlan);
    const askLlmFn = jest.fn(async () => ({
      answer: JSON.stringify({ answer: "Your net cash flow was ₹999999999.", citedFactIds: ["fact-1"] }),
    }));

    const result = await runSemanticPipeline({
      question: "Explain my net cash flow this month",
      userId: "user-1",
      now: NOW,
      routerCall,
      askLlmFn,
      financialQueryService: fakeFinancialQueryService(),
    });

    expect(result.kind).toBe("unsupported");
    expect(result.reasonCode).toMatch(/^GROUNDING_/);
    expect(result.providerCallsUsed).toEqual({ router: 1, answer: 1 });
  });

  it("uses en-IN INR currency formatting in the deterministic answer", async () => {
    const routerCall = jsonRouterCall(lookupPlan);
    const result = await runSemanticPipeline({
      question: "How much did I spend this month?",
      userId: "user-1",
      now: NOW,
      routerCall,
      askLlmFn: jest.fn(),
      financialQueryService: fakeFinancialQueryService(),
    });
    expect(result.answer).toContain("4,250");
  });

  it("idempotency checkpoint: a resumePlan skips the router call entirely (0 router calls) yet still answers deterministically", async () => {
    const routerCall = jest.fn(); // must NEVER be called when resuming
    const result = await runSemanticPipeline({
      question: "How much did I spend this month?",
      userId: "user-1",
      now: NOW,
      routerCall,
      askLlmFn: jest.fn(),
      financialQueryService: fakeFinancialQueryService(),
      resumePlan: lookupPlan,
    });

    expect(result.kind).toBe("answer");
    expect(result.providerCallsUsed).toEqual({ router: 0, answer: 0 });
    expect(routerCall).not.toHaveBeenCalled();
  });

  it("onPlanResolved is invoked with the supported plan BEFORE any answer-generation call, and its own failure never breaks the response", async () => {
    const routerCall = jsonRouterCall(explainPlan);
    const onPlanResolved = jest.fn(async () => {
      throw new Error("checkpoint persistence failed");
    });
    const askLlmFn = jest.fn(async () => ({
      answer: JSON.stringify({ answer: "Your net cash flow this month was ₹5750.", citedFactIds: ["fact-1"] }),
    }));

    const result = await runSemanticPipeline({
      question: "Explain my net cash flow this month",
      userId: "user-1",
      now: NOW,
      routerCall,
      askLlmFn,
      financialQueryService: fakeFinancialQueryService(),
      onPlanResolved,
    });

    expect(onPlanResolved).toHaveBeenCalledTimes(1);
    expect(onPlanResolved.mock.calls[0][0].outcome).toBe("supported");
    expect(result.kind).toBe("answer"); // onPlanResolved's own failure never breaks this
  });

  it("re-fetches facts fresh via financialQueryService on every call -- never reuses a cached value across two calls", async () => {
    const routerCall = jsonRouterCall(lookupPlan);
    const getExpenseTotal = jest
      .fn()
      .mockResolvedValueOnce({ hasData: true, value: 100, count: 1 })
      .mockResolvedValueOnce({ hasData: true, value: 200, count: 2 });
    const financialQueryService = fakeFinancialQueryService({ getExpenseTotal });

    const first = await runSemanticPipeline({
      question: "How much did I spend this month?",
      userId: "user-1",
      now: NOW,
      routerCall,
      askLlmFn: jest.fn(),
      financialQueryService,
    });
    const second = await runSemanticPipeline({
      question: "How much did I spend this month?",
      userId: "user-1",
      now: NOW,
      routerCall,
      askLlmFn: jest.fn(),
      financialQueryService,
    });

    expect(getExpenseTotal).toHaveBeenCalledTimes(2);
    expect(first.answer).not.toEqual(second.answer);
  });
});
