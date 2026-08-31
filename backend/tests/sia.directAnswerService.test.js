"use strict";

jest.mock("../sia/llmService", () => ({ askLlm: jest.fn() }));

const { askLlm } = require("../sia/llmService");
const { answerDirectly, validateDirectAnswer, askWithTransientRetry } = require("../sia/directAnswerService");
const { copySafe } = require("../sia/financialSnapshotService");

const snapshot = { period: { label: "this month" }, analytics: { summary: { totalSpent: 4250 } }, income: { currentMonthTotal: 10000 } };

describe("SIA direct answer service", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("passes the user question and sanitized report to the model without a query plan", async () => {
    askLlm.mockResolvedValue({ answer: "Your income is ₹10,000 and spending is ₹4,250." });

    await expect(answerDirectly({ question: "What's my income vs expenses this month?", snapshot })).resolves.toEqual({
      ok: true,
      answer: "Your income is ₹10,000 and spending is ₹4,250.",
    });
    expect(askLlm).toHaveBeenCalledWith(expect.objectContaining({ question: "What's my income vs expenses this month?", context: { financialReport: snapshot } }));
    expect(askLlm.mock.calls[0][0].structuredOutput).toBeUndefined();
  });

  it("allows a derived financial calculation while retaining leakage checks", () => {
    expect(validateDirectAnswer({ answer: "Your net cash flow is ₹5,750.", snapshot })).toEqual({ valid: true });
    expect(validateDirectAnswer({ answer: "Internal userId is abcdef0123456789abcdef01.", snapshot })).toEqual({
      valid: false,
      reasonCode: "RAW_DATA_LEAKAGE",
    });
  });

  it("retries exactly once for a transient provider response", async () => {
    askLlm.mockRejectedValueOnce(Object.assign(new Error("rate limited"), { httpStatus: 429, retryAfterMs: 0 })).mockResolvedValueOnce({ answer: "Recovered." });

    await expect(askWithTransientRetry({ question: "test" })).resolves.toEqual({ answer: "Recovered." });
    expect(askLlm).toHaveBeenCalledTimes(2);
  });

  it("strips transaction-like report values before the model can receive them", () => {
    expect(copySafe({ expenseName: "Purchase - Birthday", expenseDate: "2026-08-13", category: "Shopping", amount: 780 })).toEqual({
      category: "Shopping",
      amount: 780,
    });
  });
});
