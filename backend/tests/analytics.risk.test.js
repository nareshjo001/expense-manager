// Risk Intelligence V1: isolated characterization of the pure,
// deterministic riskAnalyzer.analyze() contract. No jest.mock/jest.doMock
// anywhere -- plain JS values in, plain JS values out.
"use strict";

const { analyze } = require("../analytics/analyzers/riskAnalyzer");
const { risk: RULES } = require("../analytics/analyzers/scores/riskRules");

const validBudgets = (overrides = {}) => ({
  hasData: true,
  hasBudget: true,
  budget: 10000,
  spent: 5000,
  isOverspent: false,
  exceededBy: 0,
  utilization: 50,
  remainingBudget: 5000,
  budgetLeft: 5000,
  status: "OnTrack",
  ...overrides,
});

const validTrends = (percentageChange = 5) => ({
  hasData: true,
  monthlyTrend: { percentageChange },
});

const validHealth = (overall = 80) => ({
  overall,
  risk: { label: "Low", color: "green" },
});

const validAnomalies = (anomalies = []) => ({
  hasData: true,
  reasonCode: null,
  flaggedCount: anomalies.length,
  anomalies,
});

const validForecast = (estimate = 5000, hasData = true) => ({
  hasData,
  nextMonthForecast: { hasData, estimate },
});

describe("backend/analytics/analyzers/riskAnalyzer", () => {
  describe("no-data and zero-risk states", () => {
    it("returns hasData:false with NO_REPORT_DATA when no source section has any data", () => {
      const result = analyze({});
      expect(result.hasData).toBe(false);
      expect(result.reasonCode).toBe("NO_REPORT_DATA");
      expect(result.riskLevel).toBe("none");
      expect(result.signals).toEqual([]);
    });

    it("handles completely missing input without throwing", () => {
      expect(() => analyze()).not.toThrow();
      expect(analyze().hasData).toBe(false);
    });

    it("returns a valid hasData:true, zero-risk result when sections exist but no rule is triggered", () => {
      const result = analyze({
        spending: { hasData: true, totalSpent: 100 },
        budgets: validBudgets(),
        trends: validTrends(2),
        financialHealth: validHealth(90),
        anomalies: validAnomalies([]),
      });

      expect(result.hasData).toBe(true);
      expect(result.reasonCode).toBeNull();
      expect(result.riskLevel).toBe("none");
      expect(result.signals).toEqual([]);
      expect(result.signalCount).toBe(0);
    });
  });

  describe("BUDGET_ALREADY_OVERSPENT", () => {
    it("flags when isOverspent is true", () => {
      const result = analyze({
        budgets: validBudgets({ isOverspent: true, exceededBy: 500, utilization: 105 }),
      });
      const signal = result.signals.find((s) => s.reasonCode === "BUDGET_ALREADY_OVERSPENT");
      expect(signal).toBeDefined();
      expect(signal.severity).toBe("high");
      expect(signal.evidence).toEqual({ exceededBy: 500, utilization: 105 });
    });

    it("does not flag when isOverspent is false", () => {
      const result = analyze({ budgets: validBudgets({ isOverspent: false }) });
      expect(result.signals.find((s) => s.reasonCode === "BUDGET_ALREADY_OVERSPENT")).toBeUndefined();
    });
  });

  describe("LOW_REMAINING_BUDGET (mutually exclusive with overspent)", () => {
    it("flags at exactly the 90% utilization threshold when not overspent", () => {
      const result = analyze({
        budgets: validBudgets({ isOverspent: false, utilization: 90, remainingBudget: 1000 }),
      });
      const signal = result.signals.find((s) => s.reasonCode === "LOW_REMAINING_BUDGET");
      expect(signal).toBeDefined();
      expect(signal.severity).toBe("moderate");
    });

    it("does not flag just below the threshold", () => {
      const result = analyze({ budgets: validBudgets({ isOverspent: false, utilization: 89.99 }) });
      expect(result.signals.find((s) => s.reasonCode === "LOW_REMAINING_BUDGET")).toBeUndefined();
    });

    it("never fires alongside BUDGET_ALREADY_OVERSPENT for the same budget (no double counting)", () => {
      const result = analyze({
        budgets: validBudgets({ isOverspent: true, exceededBy: 200, utilization: 110 }),
      });
      const codes = result.signals.map((s) => s.reasonCode);
      expect(codes).toContain("BUDGET_ALREADY_OVERSPENT");
      expect(codes).not.toContain("LOW_REMAINING_BUDGET");
    });
  });

  describe("FORECASTED_FINANCIAL_PRESSURE and PERSISTENT_SPENDING_GROWTH -- explicit non-double-counting policy", () => {
    it("both may legitimately co-occur -- they represent distinct evidence (past growth vs forward budget pressure), not the same condition counted twice", () => {
      const result = analyze({
        trends: validTrends(25), // past growth
        forecast: validForecast(12000), // forward estimate exceeds budget
        budgets: validBudgets({ budget: 10000 }),
      });
      const codes = result.signals.map((s) => s.reasonCode);
      expect(codes).toContain("PERSISTENT_SPENDING_GROWTH");
      expect(codes).toContain("FORECASTED_FINANCIAL_PRESSURE");
      // Each carries its own distinct evidence shape -- proof they are not
      // the same underlying fact duplicated.
      const growthSignal = result.signals.find((s) => s.reasonCode === "PERSISTENT_SPENDING_GROWTH");
      const pressureSignal = result.signals.find((s) => s.reasonCode === "FORECASTED_FINANCIAL_PRESSURE");
      expect(growthSignal.evidence).toHaveProperty("percentageChange");
      expect(pressureSignal.evidence).toHaveProperty("ratio");
    });
  });

  describe("PERSISTENT_SPENDING_GROWTH", () => {
    it("flags at exactly the 20% threshold", () => {
      const result = analyze({ trends: validTrends(20) });
      expect(result.signals.find((s) => s.reasonCode === "PERSISTENT_SPENDING_GROWTH")).toBeDefined();
    });

    it("does not flag just below the threshold", () => {
      const result = analyze({ trends: validTrends(19.99) });
      expect(result.signals.find((s) => s.reasonCode === "PERSISTENT_SPENDING_GROWTH")).toBeUndefined();
    });

    it("does not flag a negative (declining spend) percentage change", () => {
      const result = analyze({ trends: validTrends(-30) });
      expect(result.signals.find((s) => s.reasonCode === "PERSISTENT_SPENDING_GROWTH")).toBeUndefined();
    });
  });

  describe("ABNORMAL_HIGH_VALUE_EXPENSES", () => {
    it("flags when at least one high/very_high severity anomaly exists", () => {
      const result = analyze({
        anomalies: validAnomalies([
          { expenseId: "a1", category: "Food", amount: 3500, severity: "high" },
        ]),
      });
      const signal = result.signals.find((s) => s.reasonCode === "ABNORMAL_HIGH_VALUE_EXPENSES");
      expect(signal).toBeDefined();
      expect(signal.evidence.flaggedCount).toBe(1);
      expect(signal.evidence.anomalies[0]).toEqual({
        expenseId: "a1",
        category: "Food",
        amount: 3500,
        severity: "high",
      });
    });

    it("does not flag when only moderate-severity anomalies exist", () => {
      const result = analyze({
        anomalies: validAnomalies([
          { expenseId: "a1", category: "Food", amount: 1200, severity: "moderate" },
        ]),
      });
      expect(result.signals.find((s) => s.reasonCode === "ABNORMAL_HIGH_VALUE_EXPENSES")).toBeUndefined();
    });

    it("bounds evidence to at most 5 anomalies even when more qualify", () => {
      const many = Array.from({ length: 8 }, (_, i) => ({
        expenseId: `a${i}`,
        category: "Food",
        amount: 3000 + i,
        severity: "high",
      }));
      const result = analyze({ anomalies: validAnomalies(many) });
      const signal = result.signals.find((s) => s.reasonCode === "ABNORMAL_HIGH_VALUE_EXPENSES");
      expect(signal.evidence.anomalies).toHaveLength(5);
      expect(signal.evidence.flaggedCount).toBe(8);
    });

    it("never includes userId, raw expense name, or internal sort fields in evidence", () => {
      const result = analyze({
        anomalies: validAnomalies([
          {
            expenseId: "a1",
            expenseName: "Dinner",
            userId: "user-123",
            category: "Food",
            amount: 3500,
            severity: "high",
            _sortMultiple: 1.5,
          },
        ]),
      });
      const signal = result.signals.find((s) => s.reasonCode === "ABNORMAL_HIGH_VALUE_EXPENSES");
      expect(signal.evidence.anomalies[0]).not.toHaveProperty("userId");
      expect(signal.evidence.anomalies[0]).not.toHaveProperty("expenseName");
      expect(signal.evidence.anomalies[0]).not.toHaveProperty("_sortMultiple");
    });
  });

  describe("FORECASTED_FINANCIAL_PRESSURE (forecast unavailable must not break risk)", () => {
    it("flags when forecasted next-month spend meets or exceeds the configured budget", () => {
      const result = analyze({
        budgets: validBudgets({ budget: 5000 }),
        forecast: validForecast(5000),
      });
      const signal = result.signals.find((s) => s.reasonCode === "FORECASTED_FINANCIAL_PRESSURE");
      expect(signal).toBeDefined();
      expect(signal.evidence.ratio).toBe(1);
    });

    it("does not flag when forecast is comfortably below budget", () => {
      const result = analyze({
        budgets: validBudgets({ budget: 10000 }),
        forecast: validForecast(3000),
      });
      expect(result.signals.find((s) => s.reasonCode === "FORECASTED_FINANCIAL_PRESSURE")).toBeUndefined();
    });

    it("is simply skipped (not an error, not a no-data whole-section failure) when forecast is unavailable", () => {
      const result = analyze({
        spending: { hasData: true, totalSpent: 100 },
        budgets: validBudgets(),
        forecast: { hasData: false, nextMonthForecast: { hasData: false } },
      });

      expect(result.hasData).toBe(true);
      expect(result.reasonCode).toBeNull();
      expect(result.signals.find((s) => s.reasonCode === "FORECASTED_FINANCIAL_PRESSURE")).toBeUndefined();
    });

    it("is simply skipped when forecast is entirely absent from input", () => {
      const result = analyze({ spending: { hasData: true, totalSpent: 100 }, budgets: validBudgets() });
      expect(result.hasData).toBe(true);
      expect(() => analyze({ budgets: validBudgets() })).not.toThrow();
    });
  });

  describe("DETERIORATING_HEALTH", () => {
    it("flags at exactly the threshold (overall <= 40)", () => {
      const result = analyze({ financialHealth: validHealth(40) });
      expect(result.signals.find((s) => s.reasonCode === "DETERIORATING_HEALTH")).toBeDefined();
    });

    it("does not flag just above the threshold", () => {
      const result = analyze({ financialHealth: validHealth(40.01) });
      expect(result.signals.find((s) => s.reasonCode === "DETERIORATING_HEALTH")).toBeUndefined();
    });
  });

  describe("combined signals, severity, and deterministic sorting", () => {
    it("combines multiple independent signals without duplication", () => {
      const result = analyze({
        budgets: validBudgets({ isOverspent: true, exceededBy: 100, utilization: 101 }),
        trends: validTrends(25),
        financialHealth: validHealth(20),
      });

      const codes = result.signals.map((s) => s.reasonCode).sort();
      expect(codes).toEqual(
        ["BUDGET_ALREADY_OVERSPENT", "DETERIORATING_HEALTH", "PERSISTENT_SPENDING_GROWTH"].sort()
      );
    });

    it("overall riskLevel equals the highest severity among present signals", () => {
      const result = analyze({ trends: validTrends(25) }); // moderate only
      expect(result.riskLevel).toBe("moderate");

      const result2 = analyze({
        budgets: validBudgets({ isOverspent: true, exceededBy: 1, utilization: 100 }),
        trends: validTrends(25),
      }); // high + moderate -> high
      expect(result2.riskLevel).toBe("high");
    });

    it("sorts signals by severity descending, then reasonCode ascending, deterministically", () => {
      const result = analyze({
        budgets: validBudgets({ isOverspent: true, exceededBy: 1, utilization: 100 }), // high
        trends: validTrends(25), // moderate
        financialHealth: validHealth(10), // high
      });

      const severities = result.signals.map((s) => s.severity);
      const sorted = [...severities].sort((a, b) => ({ high: 2, moderate: 1, low: 0 }[b] - { high: 2, moderate: 1, low: 0 }[a]));
      expect(severities).toEqual(sorted);
      // Both high-severity signals: BUDGET_ALREADY_OVERSPENT < DETERIORATING_HEALTH lexicographically.
      expect(result.signals[0].reasonCode).toBe("BUDGET_ALREADY_OVERSPENT");
      expect(result.signals[1].reasonCode).toBe("DETERIORATING_HEALTH");
    });

    it("is deterministic for repeated calls with the same input", () => {
      const input = {
        budgets: validBudgets({ isOverspent: true, exceededBy: 1, utilization: 100 }),
        trends: validTrends(25),
        financialHealth: validHealth(10),
      };
      expect(analyze(input)).toEqual(analyze(input));
    });
  });

  describe("output contract and frozen rules", () => {
    it("never exposes raw records, user identifiers, or a probability-shaped field", () => {
      const result = analyze({
        budgets: validBudgets({ isOverspent: true, exceededBy: 1, utilization: 100 }),
      });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain("userId");
      expect(serialized.toLowerCase()).not.toMatch(/probability|likely to|chance of/);
    });

    it("is deeply frozen at the rules level", () => {
      expect(Object.isFrozen(RULES)).toBe(true);
      expect(Object.isFrozen(RULES.signalSeverity)).toBe(true);
    });
  });
});
