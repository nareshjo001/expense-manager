"use strict";

// AI-002 -- unit tests for naturalLanguageExpenseService.js. Mocks every
// collaborator boundary (askLlm, findRuleForMerchant, getZonedYMD) and
// asserts on the exact suggestion shape returned -- this module never
// touches a real database or LLM provider, mirroring the mocking style
// sia.aiSummaryMetrics.test.js and sia.generateMonthlySummary.test.js
// already use for this codebase.

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const FIXED_REFERENCE_DATE = { year: 2026, month: 9, day: 27 };

function loadService({ askLlmImpl, findRuleImpl } = {}) {
  jest.resetModules();
  const askLlm = jest.fn(askLlmImpl || (async () => ({ structuredOutput: null })));
  const findRuleForMerchant = jest.fn(findRuleImpl || (async () => null));
  const getZonedYMD = jest.fn(() => FIXED_REFERENCE_DATE);

  jest.doMock("../sia/llmService", () => ({ askLlm }));
  jest.doMock("../sia/periodResolver", () => ({ getZonedYMD }));
  jest.doMock("../Services/CategorizationServices/merchantRule.service", () => ({ findRuleForMerchant }));
  // categoryNormalization and expenseParsePrompt are pure -- use the real modules.

  const service = require("../sia/naturalLanguageExpenseService");
  return { service, askLlm, findRuleForMerchant, getZonedYMD };
}

afterEach(() => jest.resetModules());

describe("isValidStructuredShape", () => {
  test("accepts a well-formed 'parsed' shape", () => {
    const { service } = loadService();
    expect(
      service.isValidStructuredShape({
        outcome: "parsed",
        expenseAmount: 250,
        expenseName: "Lunch",
        expenseCategory: "Food",
        expenseDate: "2026-09-27",
        expenseDescription: "",
      })
    ).toBe(true);
  });

  test.each([
    [null],
    [undefined],
    ["a string"],
    [{ outcome: "maybe", expenseAmount: 1, expenseName: "", expenseCategory: "", expenseDate: "", expenseDescription: "" }],
    [{ outcome: "parsed", expenseAmount: "250", expenseName: "", expenseCategory: "", expenseDate: "", expenseDescription: "" }],
    [{ outcome: "parsed", expenseAmount: NaN, expenseName: "", expenseCategory: "", expenseDate: "", expenseDescription: "" }],
    [{ outcome: "parsed", expenseAmount: 1, expenseCategory: "", expenseDate: "", expenseDescription: "" }],
  ])("rejects a malformed shape: %p", (badShape) => {
    const { service } = loadService();
    expect(service.isValidStructuredShape(badShape)).toBe(false);
  });
});

describe("isYmdString", () => {
  test.each(["2026-09-27", "2000-01-01"])("accepts a valid YYYY-MM-DD string: %s", (value) => {
    const { service } = loadService();
    expect(service.isYmdString(value)).toBe(true);
  });

  test.each([
    "",
    "27-09-2026",
    "2026/09/27",
    "2026-9-27",
    "not a date",
    "2026-13-40",
    null,
    undefined,
    123,
  ])("rejects a non-YYYY-MM-DD value: %p", (badValue) => {
    const { service } = loadService();
    expect(service.isYmdString(badValue)).toBe(false);
  });
});

describe("resolveCategory", () => {
  test("a learned merchant rule takes priority over the LLM's own category guess", async () => {
    const { service, findRuleForMerchant } = loadService({
      findRuleImpl: async () => ({ category: "Groceries" }),
    });

    const result = await service.resolveCategory({ userId: USER_ID, llmCategory: "Food", merchantGuess: "Trader Joe's" });

    expect(result).toEqual({ category: "Groceries", source: "merchant_rule" });
    expect(findRuleForMerchant).toHaveBeenCalledWith(USER_ID, "Trader Joe's");
  });

  test("falls back to the LLM's category, normalized, when no rule matches", async () => {
    const { service } = loadService({ findRuleImpl: async () => null });

    const result = await service.resolveCategory({ userId: USER_ID, llmCategory: "food", merchantGuess: "Some Cafe" });

    expect(result).toEqual({ category: "Food", source: "llm" });
  });

  test("returns an empty category when neither a rule nor a usable LLM guess exists", async () => {
    const { service } = loadService({ findRuleImpl: async () => null });

    const result = await service.resolveCategory({ userId: USER_ID, llmCategory: "", merchantGuess: "" });

    expect(result).toEqual({ category: "", source: "none" });
  });

  test("a rule-lookup failure is swallowed and falls through to the LLM guess (fail-safe, never throws)", async () => {
    const { service } = loadService({
      findRuleImpl: async () => {
        throw new Error("db unreachable");
      },
    });

    const result = await service.resolveCategory({ userId: USER_ID, llmCategory: "Transport", merchantGuess: "Uber" });

    expect(result).toEqual({ category: "Transport", source: "llm" });
  });
});

describe("parseExpenseFromText", () => {
  test("propagates a provider/infra failure (askLlm throws) rather than swallowing it", async () => {
    const boom = new Error("provider down");
    const { service } = loadService({
      askLlmImpl: async () => {
        throw boom;
      },
    });

    await expect(service.parseExpenseFromText({ userId: USER_ID, text: "spent 10 on tea" })).rejects.toBe(boom);
  });

  test("a well-formed but unusable answer (outcome unsupported) is normalized to NO_AMOUNT_FOUND", async () => {
    const { service } = loadService({
      askLlmImpl: async () => ({
        structuredOutput: {
          outcome: "unsupported",
          expenseAmount: 0,
          expenseName: "",
          expenseCategory: "",
          expenseDate: "",
          expenseDescription: "",
        },
        model: "llama-3.1-70b",
        latencyMs: 400,
      }),
    });

    const result = await service.parseExpenseFromText({ userId: USER_ID, text: "what is my budget?" });

    expect(result).toEqual({
      outcome: "unsupported",
      reasonCode: "NO_AMOUNT_FOUND",
      model: "llama-3.1-70b",
      latencyMs: 400,
    });
  });

  test("a malformed structured-output shape is normalized to MALFORMED_RESPONSE", async () => {
    const { service } = loadService({
      askLlmImpl: async () => ({ structuredOutput: { outcome: "parsed" }, model: "gpt-x", latencyMs: 300 }),
    });

    const result = await service.parseExpenseFromText({ userId: USER_ID, text: "spent" });

    expect(result.outcome).toBe("unsupported");
    expect(result.reasonCode).toBe("MALFORMED_RESPONSE");
  });

  test("outcome 'parsed' with a zero/negative amount is treated as NO_AMOUNT_FOUND, never a written expense", async () => {
    const { service } = loadService({
      askLlmImpl: async () => ({
        structuredOutput: {
          outcome: "parsed",
          expenseAmount: 0,
          expenseName: "Lunch",
          expenseCategory: "Food",
          expenseDate: "2026-09-27",
          expenseDescription: "",
        },
        model: "gpt-x",
        latencyMs: 300,
      }),
    });

    const result = await service.parseExpenseFromText({ userId: USER_ID, text: "lunch" });
    expect(result.outcome).toBe("unsupported");
    expect(result.reasonCode).toBe("NO_AMOUNT_FOUND");
  });

  test("a fully-stated expense parses cleanly with needsReview false and full confidence", async () => {
    const { service } = loadService({
      askLlmImpl: async () => ({
        structuredOutput: {
          outcome: "parsed",
          expenseAmount: 250,
          expenseName: "Lunch",
          expenseCategory: "Food",
          expenseDate: "2026-09-26",
          expenseDescription: "Cafe Coffee Day",
        },
        model: "gpt-x",
        latencyMs: 300,
      }),
      findRuleImpl: async () => null,
    });

    const result = await service.parseExpenseFromText({ userId: USER_ID, text: "spent 250 on lunch yesterday at CCD" });

    expect(result).toEqual({
      outcome: "parsed",
      expenseName: "Lunch",
      expenseCategory: "Food",
      expenseAmount: 250,
      expenseDate: "2026-09-26",
      expenseDescription: "Cafe Coffee Day",
      needsReview: false,
      fieldConfidence: { expenseName: 100, expenseCategory: 100, expenseAmount: 100, expenseDate: 100 },
      model: "gpt-x",
      latencyMs: 300,
    });
  });

  test("an unstated date defaults to referenceDate and flips needsReview true", async () => {
    const { service } = loadService({
      askLlmImpl: async () => ({
        structuredOutput: {
          outcome: "parsed",
          expenseAmount: 100,
          expenseName: "Coffee",
          expenseCategory: "Food",
          expenseDate: "",
          expenseDescription: "",
        },
        model: "gpt-x",
        latencyMs: 300,
      }),
    });

    const result = await service.parseExpenseFromText({ userId: USER_ID, text: "spent 100 on coffee" });

    expect(result.expenseDate).toBe("2026-09-27");
    expect(result.needsReview).toBe(true);
    expect(result.fieldConfidence.expenseDate).toBe(0);
  });

  test("an unresolved category (empty after resolveCategory) flips needsReview true", async () => {
    const { service } = loadService({
      askLlmImpl: async () => ({
        structuredOutput: {
          outcome: "parsed",
          expenseAmount: 100,
          expenseName: "Something",
          expenseCategory: "",
          expenseDate: "2026-09-27",
          expenseDescription: "",
        },
        model: "gpt-x",
        latencyMs: 300,
      }),
      findRuleImpl: async () => null,
    });

    const result = await service.parseExpenseFromText({ userId: USER_ID, text: "spent 100 on something" });

    expect(result.expenseCategory).toBe("");
    expect(result.needsReview).toBe(true);
    expect(result.fieldConfidence.expenseCategory).toBe(0);
  });

  test("a user's own learned merchant rule is applied via the merchant/expenseDescription guess", async () => {
    const { service, findRuleForMerchant } = loadService({
      askLlmImpl: async () => ({
        structuredOutput: {
          outcome: "parsed",
          expenseAmount: 500,
          expenseName: "Groceries run",
          expenseCategory: "Shopping",
          expenseDate: "2026-09-27",
          expenseDescription: "Trader Joe's",
        },
        model: "gpt-x",
        latencyMs: 300,
      }),
      findRuleImpl: async () => ({ category: "Groceries" }),
    });

    const result = await service.parseExpenseFromText({ userId: USER_ID, text: "spent 500 at Trader Joe's" });

    expect(findRuleForMerchant).toHaveBeenCalledWith(USER_ID, "Trader Joe's");
    expect(result.expenseCategory).toBe("Groceries");
    expect(result.needsReview).toBe(false);
  });
});
