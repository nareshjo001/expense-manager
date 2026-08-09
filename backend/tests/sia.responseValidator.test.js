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

// Batch 3D: real contextFields shapes for the four newly-validated
// intents, mirroring backend/sia/contextBuilder.js's actual output exactly
// (matched to the same fixtures tests/sia.ask.test.js already uses for
// these intents, so a currency-figure claim here proves the check works
// against the real production shape, not a simplified stand-in). Each one
// deliberately nests its monetary values at least one level deep (inside
// an object or an array) to prove collectNumericValues' recursion, not
// just top-level presence.
const healthContext = {
  financialHealth: {
    overall: 75,
    risk: { label: "Low", color: "green" },
    // Mirrors healthSignals.js's generateSignals() shape: an array of
    // {type, id, metric, value, message} records, `value` carrying the
    // real number (see backend/analytics/analyzers/scores/healthSignals.js).
    signals: [
      { type: "weakness", id: "BUDGET_EXCEEDED", metric: "exceededBy", value: 250, message: "Current month's budget has been exceeded." },
    ],
  },
  summary: { healthScore: 75, riskLevel: "Low" },
};

const spendingChangeContext = {
  trends: {
    monthlyTrend: [
      { month: "2025-12", total: 900 },
      { month: "2026-01", total: 1200 },
    ],
  },
  summary: { comparePastMonth: { changePercent: 33.3, direction: "increase" }, totalSpent: 1200 },
};

const budgetContext = {
  budget: {
    budget: 5000,
    spent: 3200,
    hasBudget: true,
    status: "Warning",
    isOverspent: false,
    exceededBy: 0,
    utilization: 64,
    remainingBudget: 1800,
    budgetLeft: 36,
    projectionStatus: "AtRisk",
    projectionReliable: true,
    projectedSpent: 4300,
    projectedOverspend: 0,
    projectedOverspendPercent: 0,
  },
};

const categoryContext = {
  categories: {
    topCategory: { category: "Groceries", total: 1234.56 },
    leastCategory: { category: "Books", total: 12.34 },
    categoryDistribution: [
      { category: "Groceries", amount: 1234.56, percentage: 61.7 },
      { category: "Rent", amount: 700, percentage: 35 },
      { category: "Books", amount: 12.34, percentage: 3.3 },
    ],
    concentrationIndex: 49.2,
    top3Concentration: 100,
    categoryGrowth: [
      { category: "Groceries", previous: 1000, current: 1234.56, change: 234.56, growthPercentage: 23.46, isNewCategory: false, trend: "up" },
      { category: "Books", previous: 0, current: 12.34, change: 12.34, growthPercentage: null, isNewCategory: true, trend: "up" },
    ],
  },
};

// Batch 3D: table-driven proof that all four newly-covered intents are now
// really validated (not the old blanket `{valid:true}` bypass), against
// their real, intent-specific context shapes.
describe("sia/responseValidator -- Batch 3D: newly validated intents", () => {
  const cases = [
    {
      intent: "HEALTH_EXPLANATION",
      contextFields: healthContext,
      legitAnswer: "Your financial health score is 75, reflecting Low risk, partly because your budget was exceeded by $250.",
      noCurrencyAnswer: "Your financial health score is 75, which reflects Low overall risk.",
      nestedAnswer: "One contributing signal: your budget was exceeded by $250 this month.",
      nestedAmount: "$250",
    },
    {
      intent: "SPENDING_CHANGE_EXPLANATION",
      contextFields: spendingChangeContext,
      legitAnswer: "Your spending is now $1200 this month, up from $900 last month.",
      noCurrencyAnswer: "Your spending increased by about 33% compared to last month.",
      nestedAnswer: "Last month's total was $900, based on your monthly trend history.",
      nestedAmount: "$900",
    },
    {
      intent: "BUDGET_STATUS_EXPLANATION",
      contextFields: budgetContext,
      legitAnswer: "You have $1800 remaining on your budget, at 64% utilization.",
      noCurrencyAnswer: "You are at 64% utilization with a Warning status this month.",
      nestedAnswer: "At your current pace, you are projected to spend $4300 this month.",
      nestedAmount: "$4300",
    },
    {
      intent: "CATEGORY_SPENDING_EXPLANATION",
      contextFields: categoryContext,
      legitAnswer: "Groceries is your top category at $1234.56 this month.",
      noCurrencyAnswer: "Groceries is your top category, accounting for about 62% of your spending.",
      nestedAnswer: "Your smallest category, Books, came to $12.34 this month.",
      nestedAmount: "$12.34",
    },
  ];

  it.each(cases.map((c) => [c.intent, c]))(
    "%s: an answer with a legitimate currency amount present in the real context passes",
    (_intent, c) => {
      const result = validateGroundedAnswer({ intent: c.intent, answer: c.legitAnswer, contextFields: c.contextFields });
      expect(result).toEqual({ valid: true });
    }
  );

  it.each(cases.map((c) => [c.intent, c]))(
    "%s: an invented currency amount absent from the real context fails",
    (_intent, c) => {
      const result = validateGroundedAnswer({
        intent: c.intent,
        answer: `${c.noCurrencyAnswer} Also, an unrelated figure of $999999 applies.`,
        contextFields: c.contextFields,
      });
      expect(result).toEqual({ valid: false, reasonCode: "UNSUPPORTED_MONETARY_FIGURE" });
    }
  );

  it.each(cases.map((c) => [c.intent, c]))(
    "%s: a normal grounded answer with no currency claims passes",
    (_intent, c) => {
      const result = validateGroundedAnswer({ intent: c.intent, answer: c.noCurrencyAnswer, contextFields: c.contextFields });
      expect(result).toEqual({ valid: true });
    }
  );

  it.each(cases.map((c) => [c.intent, c]))(
    "%s: a currency amount nested inside the context's own object/array structure is recognized",
    (_intent, c) => {
      const result = validateGroundedAnswer({ intent: c.intent, answer: c.nestedAnswer, contextFields: c.contextFields });
      expect(result).toEqual({ valid: true });
      // Sanity: the nested amount really is currency-marked in the answer,
      // so a passing result here is a genuine proof of nested-value
      // recognition, not an accident of having no currency claim at all.
      expect(c.nestedAnswer).toContain(c.nestedAmount);
    }
  );

  it("HEALTH_EXPLANATION: an answer restating the plain (non-currency) health score never trips the monetary check", () => {
    const result = validateGroundedAnswer({
      intent: "HEALTH_EXPLANATION",
      answer: "Your score is 75 out of 100.",
      contextFields: healthContext,
    });
    expect(result).toEqual({ valid: true });
  });
});

// Batch 3D correction: budgetAnalyzer.js's `budget`/`spent` fields are
// passed through UNCHANGED from the stored Budget document (confirmed --
// `budget: currentMonth.budget, spent: currentMonth.spent`, no
// toSafeNumber()/round2() coercion, unlike every other derived budget or
// category value in this same context). They are therefore the only two
// fields anywhere in the seven intents' real context shapes not
// type-guaranteed to be a JS `number`.
//
// The FIRST version of this fix widened collectNumericValues() itself to
// treat any clean numeric-string leaf, anywhere in the context, as a
// supported value -- too broad, since the function has no notion of which
// field it is looking at. This corrected version instead adds a separate,
// narrowly-scoped collectKnownStringAmounts() that reads exactly
// `contextFields.budget.budget` and `contextFields.budget.spent` -- no
// other field, in no other intent's context -- ever gets numeric-string
// coercion. collectNumericValues() itself is back to numbers-only, exactly
// as it was before this correction.
describe("sia/responseValidator -- Batch 3D correction: budget/spent numeric strings, narrowly scoped", () => {
  // Same shape as `budgetContext` above, except `budget`/`spent` arrive as
  // strings -- reproducing the real, disclosed upstream contract gap
  // rather than a hypothetical.
  const budgetContextWithStringAmounts = {
    budget: {
      budget: "5000",
      spent: "3200",
      hasBudget: true,
      status: "Warning",
      isOverspent: false,
      exceededBy: 0,
      utilization: 64,
      remainingBudget: 1800,
      budgetLeft: 36,
      projectionStatus: "AtRisk",
      projectionReliable: true,
      projectedSpent: 4300,
      projectedOverspend: 0,
      projectedOverspendPercent: 0,
    },
  };

  // Requirement 1: string-typed budget and spent are accepted.
  it("recognizes a legitimate currency figure that matches a string-typed budget/spent value", () => {
    const result = validateGroundedAnswer({
      intent: "BUDGET_STATUS_EXPLANATION",
      answer: "Your budget is $5000, and you've spent $3200 so far this month.",
      contextFields: budgetContextWithStringAmounts,
    });
    expect(result).toEqual({ valid: true });
  });

  // Requirement 2: an absent/invented amount is still rejected.
  it("still rejects an invented currency figure even when budget/spent arrive as strings (this is a narrow addition, not a relaxation)", () => {
    const result = validateGroundedAnswer({
      intent: "BUDGET_STATUS_EXPLANATION",
      answer: "Your budget is $5000, plus an unrelated figure of $999999.",
      contextFields: budgetContextWithStringAmounts,
    });
    expect(result).toEqual({ valid: false, reasonCode: "UNSUPPORTED_MONETARY_FIGURE" });
  });

  // Requirement 3: a numeric-looking string in a NON-monetary field
  // (category, status, period, description, or another realistic field)
  // must never authorize the same currency claim. Two proofs: (a) within
  // BUDGET_STATUS_EXPLANATION's own `budget` object, a numeric-looking
  // value placed on `status` (a real field on this exact object,
  // deliberately NOT `budget.budget`/`budget.spent`) is ignored -- proving
  // collectKnownStringAmounts() reads by exact field path, not "any string
  // on the budget object"; (b) within CATEGORY_SPENDING_EXPLANATION's
  // context, a numeric-looking category NAME is ignored -- proving the
  // mechanism is scoped to BUDGET_STATUS_EXPLANATION's shape at all, not
  // every intent's strings.
  it("does not authorize a currency claim from a numeric-looking value on an unrelated field of the SAME budget object (status)", () => {
    const contextWithNumericStatus = {
      budget: { ...budgetContextWithStringAmounts.budget, status: "700" },
    };
    const result = validateGroundedAnswer({
      intent: "BUDGET_STATUS_EXPLANATION",
      answer: "Your budget is $5000, but an unrelated figure of $700 also applies.",
      contextFields: contextWithNumericStatus,
    });
    expect(result).toEqual({ valid: false, reasonCode: "UNSUPPORTED_MONETARY_FIGURE" });
  });

  it("does not authorize a currency claim from a numeric-looking CATEGORY NAME in an unrelated intent's context", () => {
    const contextWithNumericCategoryName = {
      categories: {
        topCategory: { category: "700", total: 250.5 },
        leastCategory: { category: "Books", total: 12.34 },
        categoryDistribution: [
          { category: "700", amount: 250.5, percentage: 61.7 },
          { category: "Books", amount: 12.34, percentage: 3.3 },
        ],
        concentrationIndex: 49.2,
        top3Concentration: 100,
        categoryGrowth: [
          { category: "700", previous: 200, current: 250.5, change: 50.5, growthPercentage: 25.25, isNewCategory: false, trend: "up" },
        ],
      },
    };
    const result = validateGroundedAnswer({
      intent: "CATEGORY_SPENDING_EXPLANATION",
      // "700" is a real category NAME in this context, but never a
      // currency figure -- $700 must not be authorized by it.
      answer: "Your top category, 700, accounts for $700 this month.",
      contextFields: contextWithNumericCategoryName,
    });
    expect(result).toEqual({ valid: false, reasonCode: "UNSUPPORTED_MONETARY_FIGURE" });
  });

  // Requirement 4: non-numeric strings remain ignored, and never crash the
  // check (a malformed/blank budget/spent value is simply not added).
  it("ignores a non-numeric budget/spent string entirely, without crashing or wrongly authorizing anything", () => {
    const contextWithMalformedAmounts = {
      budget: { ...budgetContextWithStringAmounts.budget, budget: "not-a-number", spent: "" },
    };
    const result = validateGroundedAnswer({
      intent: "BUDGET_STATUS_EXPLANATION",
      answer: "Your remaining budget is $1800.", // 1800 is a genuine number field (remainingBudget), unaffected
      contextFields: contextWithMalformedAmounts,
    });
    expect(result).toEqual({ valid: true });

    const rejected = validateGroundedAnswer({
      intent: "BUDGET_STATUS_EXPLANATION",
      answer: "Your budget is $999999.", // never actually present anywhere
      contextFields: contextWithMalformedAmounts,
    });
    expect(rejected).toEqual({ valid: false, reasonCode: "UNSUPPORTED_MONETARY_FIGURE" });
  });

  // Requirement 5: existing nested genuine-number handling is unchanged --
  // a real number nested elsewhere in the SAME context (projectedSpent,
  // three levels of object nesting away from budget/spent) still passes,
  // proving the two mechanisms (number recursion + narrow string coercion)
  // coexist correctly rather than one displacing the other.
  it("still recognizes a genuine nested number in the same context alongside string-typed budget/spent", () => {
    const result = validateGroundedAnswer({
      intent: "BUDGET_STATUS_EXPLANATION",
      answer: "At your current pace, you are projected to spend $4300 this month.",
      contextFields: budgetContextWithStringAmounts,
    });
    expect(result).toEqual({ valid: true });
  });
});

// Batch 3D: proves the shared generic leakage checks (leaked ObjectId, raw
// internal field token, echoed JSON-key fragment) are active across ALL
// seven supported intents -- not just the three Batch 2 covered. One
// representative context per intent is enough: these checks are answer-text
// pattern checks that do not depend on the specific context shape, so a
// per-intent matrix (rather than re-deriving every context/answer
// combination already covered above) is the non-duplicative way to prove
// they are wired for every intent.
describe("sia/responseValidator -- Batch 3D: shared leakage checks across all seven intents", () => {
  const allIntentContexts = [
    ["HEALTH_EXPLANATION", healthContext],
    ["SPENDING_CHANGE_EXPLANATION", spendingChangeContext],
    ["BUDGET_STATUS_EXPLANATION", budgetContext],
    ["CATEGORY_SPENDING_EXPLANATION", categoryContext],
    ["ANOMALY_EXPLANATION", anomalyContext],
    ["SPENDING_FORECAST_EXPLANATION", forecastContext],
    ["FINANCIAL_RISK_EXPLANATION", riskContext],
  ];

  it.each(allIntentContexts)("%s: rejects a leaked Mongo-shaped identifier", (intent, contextFields) => {
    const result = validateGroundedAnswer({
      intent,
      answer: "See record 64f1a2b3c4d5e6f7a8b9c0d1 for details.",
      contextFields,
    });
    expect(result).toEqual({ valid: false, reasonCode: "LEAKED_IDENTIFIER" });
  });

  it.each(allIntentContexts)("%s: rejects a raw internal field-name token", (intent, contextFields) => {
    const result = validateGroundedAnswer({
      intent,
      answer: "Internally this used the userId field to look things up.",
      contextFields,
    });
    expect(result).toEqual({ valid: false, reasonCode: "RAW_FIELD_LEAKAGE" });
  });

  it.each(allIntentContexts)("%s: rejects a literal echoed JSON key fragment", (intent, contextFields) => {
    const result = validateGroundedAnswer({
      intent,
      answer: 'The data shows "status": "active" internally.',
      contextFields,
    });
    expect(result).toEqual({ valid: false, reasonCode: "RAW_FIELD_LEAKAGE" });
  });

  it.each(allIntentContexts)("%s: rejects an empty or whitespace-only answer", (intent, contextFields) => {
    const result = validateGroundedAnswer({ intent, answer: "   ", contextFields });
    expect(result).toEqual({ valid: false, reasonCode: "EMPTY_OR_MALFORMED_ANSWER" });
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
