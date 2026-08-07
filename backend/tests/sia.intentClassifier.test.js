// Unit tests for backend/sia/intentClassifier.js.
//
// Pure function, no dependencies -- no mocking needed, no network, no
// MongoDB, Redis, ML service, or provider call is possible.
//
// M2-2 scope: extends this suite to also cover SPENDING_CHANGE_EXPLANATION
// -- the exact identifier already established by
// backend/sia/contextBuilder.js's M1-2 implementation -- while every M2-1
// HEALTH_EXPLANATION case above stays exactly as it was (unchanged
// assertions, just relocated within this describe block).
// M2-3 scope: extends this suite to also cover BUDGET_STATUS_EXPLANATION
// -- the exact identifier already established by
// backend/sia/contextBuilder.js's M2-3A implementation -- while every
// M2-1/M2-2 case above stays exactly as it was.
"use strict";

const { classifyIntent } = require("../sia/intentClassifier");

describe("backend/sia/intentClassifier", () => {
  it("recognizes clear financial-health-score explanation questions", () => {
    expect(classifyIntent("Why is my financial health score low?")).toBe("HEALTH_EXPLANATION");
    expect(classifyIntent("Explain my financial health score.")).toBe("HEALTH_EXPLANATION");
    expect(classifyIntent("What does my financial health score mean?")).toBe("HEALTH_EXPLANATION");
  });

  it("recognizes financial-risk-level explanation questions", () => {
    expect(classifyIntent("Why is my financial risk level high?")).toBe("HEALTH_EXPLANATION");
    expect(classifyIntent("What is the meaning of my financial risk level?")).toBe("HEALTH_EXPLANATION");
  });

  it("handles case and surrounding whitespace for health questions", () => {
    expect(classifyIntent("   WHY IS MY FINANCIAL HEALTH SCORE LOW?   ")).toBe("HEALTH_EXPLANATION");
    expect(classifyIntent("\nExplain My Financial Health Score.\t")).toBe("HEALTH_EXPLANATION");
  });

  it("rejects budget, investment, medical-health, unrelated, ambiguous, empty, and non-string input", () => {
    expect(classifyIntent("What is my budget?")).toBeNull();
    expect(classifyIntent("Give me investment advice.")).toBeNull();
    expect(classifyIntent("How is my health?")).toBeNull();
    expect(classifyIntent("What's the weather today?")).toBeNull();
    expect(classifyIntent("financial health")).toBeNull(); // topic only, no explanation request
    expect(classifyIntent("")).toBeNull();
    expect(classifyIntent("   ")).toBeNull();
    expect(classifyIntent(null)).toBeNull();
    expect(classifyIntent(undefined)).toBeNull();
    expect(classifyIntent(42)).toBeNull();
    expect(classifyIntent({})).toBeNull();
    expect(classifyIntent(["Why is my financial health score low?"])).toBeNull();
  });

  it("is conservative: mentioning the health/risk topic without requesting an explanation is not guessed as a match", () => {
    expect(classifyIntent("My financial health score is 72.")).toBeNull();
    expect(classifyIntent("financial risk level")).toBeNull();
    expect(classifyIntent("My financial risk level is Low.")).toBeNull();
  });

  // -- M2-2: SPENDING_CHANGE_EXPLANATION -------------------------------------

  it("recognizes the six required spending-change explanation questions", () => {
    expect(classifyIntent("Why did my spending increase?")).toBe("SPENDING_CHANGE_EXPLANATION");
    expect(classifyIntent("Why did I spend more this month?")).toBe("SPENDING_CHANGE_EXPLANATION");
    expect(classifyIntent("Explain how my spending changed this month.")).toBe(
      "SPENDING_CHANGE_EXPLANATION"
    );
    expect(classifyIntent("What contributed to the increase in my expenses?")).toBe(
      "SPENDING_CHANGE_EXPLANATION"
    );
    expect(classifyIntent("Why are my expenses higher than last month?")).toBe(
      "SPENDING_CHANGE_EXPLANATION"
    );
    expect(classifyIntent("What changed in my spending compared with last month?")).toBe(
      "SPENDING_CHANGE_EXPLANATION"
    );
  });

  it("recognizes a spending decrease explanation question", () => {
    expect(classifyIntent("Why did my spending decrease this month?")).toBe(
      "SPENDING_CHANGE_EXPLANATION"
    );
    expect(classifyIntent("Why are my expenses lower than last month?")).toBe(
      "SPENDING_CHANGE_EXPLANATION"
    );
  });

  it("recognizes a spending comparison explanation question", () => {
    expect(classifyIntent("Compare my spending to last month.")).toBe("SPENDING_CHANGE_EXPLANATION");
    expect(classifyIntent("How does my spending this month compare with last month?")).toBe(
      "SPENDING_CHANGE_EXPLANATION"
    );
  });

  it("recognizes a category-contribution spending question", () => {
    expect(classifyIntent("Which category contributed most to my spending increase?")).toBe(
      "SPENDING_CHANGE_EXPLANATION"
    );
    expect(classifyIntent("What contributed to my expenses this month?")).toBe(
      "SPENDING_CHANGE_EXPLANATION"
    );
  });

  it("handles case and surrounding whitespace for spending-change questions", () => {
    expect(classifyIntent("   WHY DID MY SPENDING INCREASE?   ")).toBe("SPENDING_CHANGE_EXPLANATION");
    expect(classifyIntent("\nExplain How My Spending Changed This Month.\t")).toBe(
      "SPENDING_CHANGE_EXPLANATION"
    );
  });

  it("rejects a plain spending/expense lookup with no explanation or change concept", () => {
    expect(classifyIntent("How much did I spend this month?")).toBeNull();
    expect(classifyIntent("Show my expenses.")).toBeNull();
    expect(classifyIntent("List my spending.")).toBeNull();
  });

  it("rejects budget, investment, prediction, anomaly, and fraud questions as spending-change", () => {
    expect(classifyIntent("What is my budget for this month?")).toBeNull();
    expect(classifyIntent("Give me investment advice.")).toBeNull();
    expect(classifyIntent("Predict my spending next month.")).toBeNull();
    expect(classifyIntent("Is there anomalous activity in my account?")).toBeNull();
    expect(classifyIntent("Is this transaction fraud?")).toBeNull();
  });

  it("rejects ambiguous and non-string input for spending-change", () => {
    expect(classifyIntent("spending")).toBeNull(); // topic only, no change/explanation concept
    expect(classifyIntent("expenses")).toBeNull();
    expect(classifyIntent(null)).toBeNull();
    expect(classifyIntent(undefined)).toBeNull();
    expect(classifyIntent(42)).toBeNull();
    expect(classifyIntent({})).toBeNull();
    expect(classifyIntent(["Why did my spending increase?"])).toBeNull();
  });

  it("never misclassifies a health question as spending, and never misclassifies a spending question as health", () => {
    expect(classifyIntent("Why is my financial health score low?")).toBe("HEALTH_EXPLANATION");
    expect(classifyIntent("Why is my financial risk level high?")).toBe("HEALTH_EXPLANATION");
    expect(classifyIntent("Why did my spending increase?")).toBe("SPENDING_CHANGE_EXPLANATION");
    expect(classifyIntent("Why did my expenses change?")).toBe("SPENDING_CHANGE_EXPLANATION");
  });

  // -- M2-3: BUDGET_STATUS_EXPLANATION ---------------------------------------

  it("recognizes a clear budget-status explanation question", () => {
    expect(classifyIntent("Explain my current budget status.")).toBe("BUDGET_STATUS_EXPLANATION");
  });

  it("recognizes budget-utilization questions", () => {
    expect(classifyIntent("Why is my budget utilization high?")).toBe("BUDGET_STATUS_EXPLANATION");
    expect(classifyIntent("How much of my budget have I used?")).toBe("BUDGET_STATUS_EXPLANATION");
  });

  it("recognizes remaining-budget questions", () => {
    expect(classifyIntent("How much budget do I have remaining?")).toBe("BUDGET_STATUS_EXPLANATION");
  });

  it("recognizes over-budget and under-budget questions", () => {
    expect(classifyIntent("Am I currently over my budget?")).toBe("BUDGET_STATUS_EXPLANATION");
    expect(classifyIntent("Am I under my monthly budget?")).toBe("BUDGET_STATUS_EXPLANATION");
  });

  it("recognizes existing report-calculated budget risk/projection questions", () => {
    expect(classifyIntent("Am I at risk of exceeding my budget this month?")).toBe(
      "BUDGET_STATUS_EXPLANATION"
    );
    expect(classifyIntent("Explain my projected budget status.")).toBe("BUDGET_STATUS_EXPLANATION");
    expect(classifyIntent("Why does the report show I may exceed my budget?")).toBe(
      "BUDGET_STATUS_EXPLANATION"
    );
  });

  it("recognizes a projection-reliability question", () => {
    expect(classifyIntent("Is my budget projection reliable?")).toBe("BUDGET_STATUS_EXPLANATION");
  });

  it("handles case and surrounding whitespace for budget-status questions", () => {
    expect(classifyIntent("   EXPLAIN MY CURRENT BUDGET STATUS.   ")).toBe("BUDGET_STATUS_EXPLANATION");
    expect(classifyIntent("\nAm I Currently Over My Budget?\t")).toBe("BUDGET_STATUS_EXPLANATION");
  });

  it("rejects budget mutation requests", () => {
    expect(classifyIntent("Create a budget.")).toBeNull();
    expect(classifyIntent("Set my budget to 20000.")).toBeNull();
    expect(classifyIntent("Increase my budget.")).toBeNull();
    expect(classifyIntent("Delete my budget.")).toBeNull();
  });

  // The plain topic+verb gate alone would wrongly recognize these, because
  // each one contains a recognized verb ("explain"/"why"/"status") that
  // ALSO happens to appear in a genuine mutation or advice request. The
  // BUDGET_ACTION_EXCLUSION_PATTERN vetoes exactly this shape: a
  // mutation/advice verb (set/create/update/edit/increase/decrease/raise/
  // lower/delete/remove/modify/change/spend/invest) governing "budget" as
  // its direct object.
  it("rejects mutation requests phrased with a recognized explanation verb (why/explain/status)", () => {
    expect(classifyIntent("Explain how to increase my budget.")).toBeNull();
    expect(classifyIntent("Why should I change my budget?")).toBeNull();
    expect(classifyIntent("Can you explain how to set my budget?")).toBeNull();
    expect(classifyIntent("Please delete my budget status.")).toBeNull();
  });

  it("rejects advice requests phrased with a recognized explanation verb (remaining)", () => {
    expect(classifyIntent("Should I spend my remaining budget?")).toBeNull();
    expect(classifyIntent("How should I invest my remaining budget?")).toBeNull();
    expect(classifyIntent("What should my monthly budget be?")).toBeNull();
  });

  // The exclusion above must be narrow: it only vetoes a mutation/advice
  // verb appearing BEFORE "budget" (governing it as a direct object). A
  // verb describing something the report already computed, appearing
  // AFTER "budget", must remain recognized.
  it("does not over-exclude legitimate explanations of a reported budget change", () => {
    expect(classifyIntent("Why did my budget status change?")).toBe("BUDGET_STATUS_EXPLANATION");
    expect(classifyIntent("Explain why my budget utilization increased.")).toBe(
      "BUDGET_STATUS_EXPLANATION"
    );
    expect(classifyIntent("Why does the report show I may exceed my budget?")).toBe(
      "BUDGET_STATUS_EXPLANATION"
    );
  });

  it("rejects budget-definition and budget-advice questions", () => {
    expect(classifyIntent("What is a budget?")).toBeNull();
    expect(classifyIntent("What should my budget be?")).toBeNull();
  });

  it("rejects affordability and other financial-advice questions", () => {
    expect(classifyIntent("Can I afford a phone?")).toBeNull();
    expect(classifyIntent("How should I invest my remaining money?")).toBeNull();
    expect(classifyIntent("Give me financial advice.")).toBeNull();
  });

  it("rejects general forecasting and generic expense/lookup questions as budget-status", () => {
    expect(classifyIntent("Predict my expenses next month.")).toBeNull();
    expect(classifyIntent("Show all my expenses.")).toBeNull();
    expect(classifyIntent("How much did I spend?")).toBeNull(); // no clear budget relationship
  });

  it("rejects fraud, anomaly, and transaction-editing questions as budget-status", () => {
    expect(classifyIntent("Is there anomalous activity in my account?")).toBeNull();
    expect(classifyIntent("Is this transaction fraud?")).toBeNull();
  });

  it("rejects ambiguous, empty, and non-string input for budget-status", () => {
    expect(classifyIntent("budget")).toBeNull(); // topic only, no status/utilization/risk concept
    expect(classifyIntent("")).toBeNull();
    expect(classifyIntent("   ")).toBeNull();
    expect(classifyIntent(null)).toBeNull();
    expect(classifyIntent(undefined)).toBeNull();
    expect(classifyIntent(42)).toBeNull();
    expect(classifyIntent({})).toBeNull();
    expect(classifyIntent(["Explain my current budget status."])).toBeNull();
  });

  it("never misclassifies a health question as budget, and a budget question never becomes health", () => {
    expect(classifyIntent("Why is my financial health score low?")).toBe("HEALTH_EXPLANATION");
    expect(classifyIntent("Why is my financial risk level high?")).toBe("HEALTH_EXPLANATION");
    expect(classifyIntent("Explain my current budget status.")).toBe("BUDGET_STATUS_EXPLANATION");
    expect(classifyIntent("Am I at risk of exceeding my budget this month?")).toBe(
      "BUDGET_STATUS_EXPLANATION"
    );
  });

  it("never misclassifies a spending-change question as budget, and a budget question never becomes spending-change", () => {
    expect(classifyIntent("Why did my spending increase?")).toBe("SPENDING_CHANGE_EXPLANATION");
    expect(classifyIntent("Why did my expenses change?")).toBe("SPENDING_CHANGE_EXPLANATION");
    expect(classifyIntent("How much of my budget have I used?")).toBe("BUDGET_STATUS_EXPLANATION");
    expect(classifyIntent("How much budget do I have remaining?")).toBe("BUDGET_STATUS_EXPLANATION");
  });

  it("incidental use of health/spending/status/change wording inside a budget question does not cross-classify it away from budget", () => {
    // Contains "status" (a HEALTH-adjacent-sounding word) but the topic is
    // explicitly budget, not "financial health"/"financial risk" -- must
    // stay BUDGET_STATUS_EXPLANATION, not HEALTH_EXPLANATION.
    expect(classifyIntent("Explain my current budget status.")).toBe("BUDGET_STATUS_EXPLANATION");
  });

  it("returns only HEALTH_EXPLANATION, SPENDING_CHANGE_EXPLANATION, BUDGET_STATUS_EXPLANATION, or null -- never a guessed fallback", () => {
    const sampleQuestions = [
      "Why is my financial health score low?",
      "Why did my spending increase?",
      "Explain my current budget status.",
      "How much did I spend?",
      "",
      null,
      "What is my budget?",
      "Explain my financial health score.",
      "Explain how my spending changed this month.",
      "What's the weather today?",
      "Create a budget.",
    ];
    const allowed = new Set([
      "HEALTH_EXPLANATION",
      "SPENDING_CHANGE_EXPLANATION",
      "BUDGET_STATUS_EXPLANATION",
      null,
    ]);
    for (const question of sampleQuestions) {
      expect(allowed.has(classifyIntent(question))).toBe(true);
    }
  });
});
