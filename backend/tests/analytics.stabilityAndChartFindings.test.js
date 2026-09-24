// ANL-001-T03 -- stabilityScoreAnalyzer + chartFindingsAnalyzer.

const { analyze: analyzeStability } = require("../analytics/analyzers/stabilityScoreAnalyzer");
const { analyze: analyzeChartFindings } = require("../analytics/analyzers/chartFindingsAnalyzer");

describe("stabilityScoreAnalyzer", () => {
  it("returns hasData:false when coefficientOfVariation is null", () => {
    const result = analyzeStability({ stability: { coefficientOfVariation: null, weeklyTotals: [], reason: "NO_VALID_DATA" } });
    expect(result).toEqual({ hasData: false, coefficientOfVariation: null, score: null, tier: null });
  });

  it("returns hasData:false when stability is missing entirely", () => {
    const result = analyzeStability({});
    expect(result).toEqual({ hasData: false, coefficientOfVariation: null, score: null, tier: null });
  });

  it("classifies a low coefficient of variation as HighlyStable", () => {
    // score = 100 - 0.1*100 = 90 -> HighlyStable
    const result = analyzeStability({ stability: { coefficientOfVariation: 0.1 } });
    expect(result.hasData).toBe(true);
    expect(result.coefficientOfVariation).toBe(0.1);
    expect(result.score).toBe(90);
    expect(result.tier).toBe("HighlyStable");
  });

  it("classifies a mid coefficient of variation as ModeratelyStable", () => {
    // score = 100 - 0.4*100 = 60 -> ModeratelyStable
    const result = analyzeStability({ stability: { coefficientOfVariation: 0.4 } });
    expect(result.score).toBe(60);
    expect(result.tier).toBe("ModeratelyStable");
  });

  it("classifies a high coefficient of variation as LowStability", () => {
    // score = 100 - 0.8*100 = 20 -> LowStability
    const result = analyzeStability({ stability: { coefficientOfVariation: 0.8 } });
    expect(result.score).toBe(20);
    expect(result.tier).toBe("LowStability");
  });

  it("clamps a coefficient of variation that would push the score negative to 0", () => {
    // score = 100 - 2.5*100 = -150 -> clamped to 0
    const result = analyzeStability({ stability: { coefficientOfVariation: 2.5 } });
    expect(result.score).toBe(0);
    expect(result.tier).toBe("LowStability");
  });
});

describe("chartFindingsAnalyzer", () => {
  describe("line", () => {
    it("reports hasData:false when trendReport.hasData is false", () => {
      const result = analyzeChartFindings({ trendReport: { hasData: false } });
      expect(result.line).toEqual({ hasData: false, direction: null, volatility: null });
    });

    it("populates direction and volatility from a populated trendReport", () => {
      const result = analyzeChartFindings({
        trendReport: {
          hasData: true,
          monthlyTrend: { direction: "up" },
          spendingDirectionStrength: 42.5,
        },
      });
      expect(result.line).toEqual({ hasData: true, direction: "up", volatility: 42.5 });
    });
  });

  describe("bar", () => {
    it("reports hasData:false when budgetReport.hasBudget is false", () => {
      const result = analyzeChartFindings({
        budgetReport: { hasBudget: false },
        categoryReport: { top3Concentration: 80 },
      });
      expect(result.bar).toEqual({ hasData: false, pressureCategory: null, concentrationRatio: null });
    });

    it("populates pressureCategory and scales top3Concentration (0-100) to a 0-1 ratio when hasBudget is true", () => {
      const result = analyzeChartFindings({
        budgetReport: { hasBudget: true, status: "Warning" },
        categoryReport: { top3Concentration: 80 },
      });
      expect(result.bar).toEqual({ hasData: true, pressureCategory: "Warning", concentrationRatio: 0.8 });
    });
  });

  describe("pie", () => {
    it("reports hasData:false when categoryReport.hasData is false", () => {
      const result = analyzeChartFindings({ categoryReport: { hasData: false } });
      expect(result.pie).toEqual({ hasData: false, concentrationRatio: null, topSlice: null });
    });

    it("populates topSlice and scales concentrationIndex (0-100) to a 0-1 ratio when hasData is true", () => {
      const result = analyzeChartFindings({
        categoryReport: {
          hasData: true,
          concentrationIndex: 45.5,
          topCategory: { category: "Shopping" },
        },
      });
      expect(result.pie).toEqual({ hasData: true, concentrationRatio: 0.455, topSlice: "Shopping" });
    });
  });

  it("always returns line, bar, and pie keys, never omitting one", () => {
    const result = analyzeChartFindings({});
    expect(result).toHaveProperty("line");
    expect(result).toHaveProperty("bar");
    expect(result).toHaveProperty("pie");
  });
});
