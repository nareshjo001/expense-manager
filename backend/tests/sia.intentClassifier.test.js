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

  it("returns only HEALTH_EXPLANATION, SPENDING_CHANGE_EXPLANATION, or null -- never a guessed fallback", () => {
    const sampleQuestions = [
      "Why is my financial health score low?",
      "Why did my spending increase?",
      "How much did I spend?",
      "",
      null,
      "What is my budget?",
      "Explain my financial health score.",
      "Explain how my spending changed this month.",
      "What's the weather today?",
    ];
    const allowed = new Set(["HEALTH_EXPLANATION", "SPENDING_CHANGE_EXPLANATION", null]);
    for (const question of sampleQuestions) {
      expect(allowed.has(classifyIntent(question))).toBe(true);
    }
  });
});
