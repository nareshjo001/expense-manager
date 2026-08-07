// Unit tests for backend/sia/intentClassifier.js.
//
// Pure function, no dependencies -- no mocking needed, no network, no
// MongoDB, Redis, ML service, or provider call is possible.
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

  it("handles case and surrounding whitespace", () => {
    expect(classifyIntent("   WHY IS MY FINANCIAL HEALTH SCORE LOW?   ")).toBe("HEALTH_EXPLANATION");
    expect(classifyIntent("\nExplain My Financial Health Score.\t")).toBe("HEALTH_EXPLANATION");
  });

  it("rejects spending-change questions", () => {
    expect(classifyIntent("Why did my spending increase?")).toBeNull();
    expect(classifyIntent("How much did I spend this month?")).toBeNull();
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

  it("returns only HEALTH_EXPLANATION or null", () => {
    const sampleQuestions = [
      "Why is my financial health score low?",
      "How much did I spend?",
      "",
      null,
      "What is my budget?",
      "Explain my financial health score.",
    ];
    for (const question of sampleQuestions) {
      const result = classifyIntent(question);
      expect(result === "HEALTH_EXPLANATION" || result === null).toBe(true);
    }
  });

  it("is conservative: mentioning the topic without requesting an explanation is not guessed as a match", () => {
    expect(classifyIntent("My financial health score is 72.")).toBeNull();
    expect(classifyIntent("financial risk level")).toBeNull();
    expect(classifyIntent("My financial risk level is Low.")).toBeNull();
  });
});
