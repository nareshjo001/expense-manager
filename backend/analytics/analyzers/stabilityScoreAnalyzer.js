// Js::buildStability so the analytics report carries the same stability tiering the UI used to compute client-side.

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
