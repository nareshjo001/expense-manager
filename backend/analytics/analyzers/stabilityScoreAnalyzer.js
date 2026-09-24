// ANL-001-T03 -- server-side port of ANL-001-T02's StabilityScore, moved
// out of frontend/src/components/monthlyInsights/OverallInsight.js::buildStability
// so the analytics report carries the same stability tiering the UI used
// to compute client-side. Consumes spendingAnalyzer.js's
// calculateSpendingStability() output (report.spending.stability) --
// { coefficientOfVariation: number|null, weeklyTotals: number[], reason: string|null }.

// Score/tier thresholds mirror the frontend implementation exactly --
// see OverallInsight.js::buildStability for the formula this replaces.
const calculateStabilityScore = (coefficientOfVariation) =>
  Math.max(0, Math.min(100, Math.round(100 - coefficientOfVariation * 100)));

const calculateStabilityTier = (score) => {
  if (score >= 75) return "HighlyStable";
  if (score >= 50) return "ModeratelyStable";
  return "LowStability";
};

const analyze = ({ stability = {} } = {}) => {
  if (!Number.isFinite(stability.coefficientOfVariation)) {
    return { hasData: false, coefficientOfVariation: null, score: null, tier: null };
  }

  const score = calculateStabilityScore(stability.coefficientOfVariation);

  return {
    hasData: true,
    coefficientOfVariation: stability.coefficientOfVariation,
    score,
    tier: calculateStabilityTier(score),
  };
};

module.exports = {
  calculateStabilityScore,
  calculateStabilityTier,
  analyze,
};
