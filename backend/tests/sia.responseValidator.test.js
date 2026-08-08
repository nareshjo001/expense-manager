// Unit tests for backend/sia/responseValidator.js -- Batch 2 architecture
// closure: real, deterministic grounded-response validation, not just a
// system-prompt instruction. No LLM calls anywhere here -- plain strings
// in, plain verdicts out.
"use strict";

const { validateGroundedAnswer } = require("../sia/responseValidator");

const forecastContext = {
  forecast: {
    hasData: true,
    nextMonthForecast: { hasData: true, isEstimate: true, estimate: 1200, range: { lower: 1000, upper: 1400 } },
  },
};

const riskContext = {
  risk: {
    hasData: true,
    riskLevel: "high",
    signals: [{ reasonCode: "BUDGET_ALREADY_OVERSPENT", severity: "high", evidence: { exceededBy: 200, utilization: 110 } }],
  },
  summary: { totalSpent: 5000, budgetStatus: "Overspent" },
};

const anomalyContext = {
  anomalies: {
    hasData: true,
    flaggedCount: 1,
    records: [{ expenseId: "a1", category: "Food", amount: 3500, severity: "high", reasonCode: "CATEGORY_AMOUNT_SPIKE" }],
  },
};

describe("sia/responseValidator -- untouched intents", () => {
  it("always returns valid for the four original intents, regardless of content", () => {
    for (const intent of ["HEALTH_EXPLANATION", "SPENDING_CHANGE_EXPLANATION", "BUDGET_STATUS_EXPLANATION", "CATEGORY_SPENDING_EXPLANATION"]) {
      const result = validateGroundedAnswer({
        intent,
        answer: "This mentions $999999 and 100% guaranteed and 64f1a2b3c4d5e6f7a8b9c0d1 and \"userId\": leaks.",
        contextFields: {},
      });
      expect(result).toEqual({ valid: true });
    }
  });
});

describe("sia/responseValidator -- malformed/empty", () => {
  it("rejects an empty or whitespace-only answer", () => {
    expect(validateGroundedAnswer({ intent: "SPENDING_FORECAST_EXPLANATION", answer: "   ", contextFields: forecastContext }).valid).toBe(false);
    expect(validateGroundedAnswer({ intent: "SPENDING_FORECAST_EXPLANATION", answer: null, contextFields: forecastContext }).valid).toBe(false);
  });
});

describe("sia/responseValidator -- leaked identifiers and raw fields", () => {
  it("rejects a leaked 24-character Mongo-shaped identifier", () => {
    const result = validateGroundedAnswer({
      intent: "ANOMALY_EXPLANATION",
      answer: "Expense 64f1a2b3c4d5e6f7a8b9c0d1 was flagged as unusual spending.",
      contextFields: anomalyContext,
    });
    expect(result).toEqual({ valid: false, reasonCode: "LEAKED_IDENTIFIER" });
  });

  it("rejects a raw internal field-name token", () => {
    const result = validateGroundedAnswer({
      intent: "SPENDING_FORECAST_EXPLANATION",
      answer: "Based on your recentExpensePool, next month looks similar.",
      contextFields: forecastContext,
    });
    expect(result).toEqual({ valid: false, reasonCode: "RAW_FIELD_LEAKAGE" });
  });

  it("rejects a literal JSON key fragment echoed back", () => {
    const result = validateGroundedAnswer({
      intent: "FINANCIAL_RISK_EXPLANATION",
      answer: 'Your risk evidence shows "exceededBy": 200 in the data.',
      contextFields: riskContext,
    });
    expect(result).toEqual({ valid: false, reasonCode: "RAW_FIELD_LEAKAGE" });
  });
});

describe("sia/responseValidator -- fraud claims (anomaly only)", () => {
  it("rejects a fraud claim for a rule-detected anomaly", () => {
    const result = validateGroundedAnswer({
      intent: "ANOMALY_EXPLANATION",
      answer: "This expense looks like fraud on your account.",
      contextFields: anomalyContext,
    });
    expect(result).toEqual({ valid: false, reasonCode: "FRAUD_CLAIM" });
  });

  it("does not reject the word 'unusual' or 'flagged' -- only actual fraud-family words", () => {
    const result = validateGroundedAnswer({
      intent: "ANOMALY_EXPLANATION",
      answer: "This expense was flagged as unusual relative to your usual Food spending.",
      contextFields: anomalyContext,
    });
    expect(result).toEqual({ valid: true });
  });
});

describe("sia/responseValidator -- unsupported certainty/probability language", () => {
  it("rejects a probability claim for risk (risk's real contract never carries a probability)", () => {
    const result = validateGroundedAnswer({
      intent: "FINANCIAL_RISK_EXPLANATION",
      answer: "There is a 75% chance you will overspend next month.",
      contextFields: riskContext,
    });
    expect(result).toEqual({ valid: false, reasonCode: "UNSUPPORTED_CERTAINTY_LANGUAGE" });
  });

  it("rejects a guarantee claim for a forecast estimate", () => {
    const result = validateGroundedAnswer({
      intent: "SPENDING_FORECAST_EXPLANATION",
      answer: "You are guaranteed to spend $1200 next month.",
      contextFields: forecastContext,
    });
    expect(result).toEqual({ valid: false, reasonCode: "UNSUPPORTED_CERTAINTY_LANGUAGE" });
  });
});

describe("sia/responseValidator -- out-of-scope advice (risk only)", () => {
  it("rejects investment-advice language", () => {
    const result = validateGroundedAnswer({
      intent: "FINANCIAL_RISK_EXPLANATION",
      answer: "Given this risk, you should invest in stocks to diversify.",
      contextFields: riskContext,
    });
    expect(result).toEqual({ valid: false, reasonCode: "OUT_OF_SCOPE_ADVICE" });
  });
});

describe("sia/responseValidator -- monetary figures not distinguishing harmless count language", () => {
  it("rejects an invented currency amount not present anywhere in the context", () => {
    const result = validateGroundedAnswer({
      intent: "SPENDING_FORECAST_EXPLANATION",
      answer: "Next month you are estimated to spend $99999.",
      contextFields: forecastContext,
    });
    expect(result).toEqual({ valid: false, reasonCode: "UNSUPPORTED_MONETARY_FIGURE" });
  });

  it("accepts a currency amount that matches a context value exactly", () => {
    const result = validateGroundedAnswer({
      intent: "SPENDING_FORECAST_EXPLANATION",
      answer: "Next month's estimate is $1200, with a range of $1000 to $1400.",
      contextFields: forecastContext,
    });
    expect(result).toEqual({ valid: true });
  });

  it("does not flag harmless, non-currency-marked count language", () => {
    const result = validateGroundedAnswer({
      intent: "FINANCIAL_RISK_EXPLANATION",
      answer: "There is 1 risk signal, at high severity, based on an overspent budget.",
      contextFields: riskContext,
    });
    expect(result).toEqual({ valid: true });
  });
});

describe("sia/responseValidator -- valid grounded paraphrases pass", () => {
  it("a faithful anomaly paraphrase passes", () => {
    const result = validateGroundedAnswer({
      intent: "ANOMALY_EXPLANATION",
      answer: "One Food expense of $3500 was flagged as unusual compared to your normal spending in that category.",
      contextFields: anomalyContext,
    });
    expect(result).toEqual({ valid: true });
  });

  it("a faithful risk paraphrase passes", () => {
    const result = validateGroundedAnswer({
      intent: "FINANCIAL_RISK_EXPLANATION",
      answer: "Your risk level is high because your budget is already overspent by $200, at 110% utilization.",
      contextFields: riskContext,
    });
    expect(result).toEqual({ valid: true });
  });
});
