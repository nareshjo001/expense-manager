const rules = require("../scores/trendRules");

const REASONS = {
  NO_ACTIVITY_DATA: "NO_ACTIVITY_DATA",
  UNKNOWN_DIRECTION: "UNKNOWN_DIRECTION",
};

const emptyResult = (reason) => ({
  score: null,
  maxScore: rules.trend.maxScore,
  normalizedScore: null,
  reason,
  breakdown: null,
});

const calculateTrendScore = (trendAnalysis = {}) => {
  if (trendAnalysis.hasData === false) {
    return emptyResult(REASONS.NO_ACTIVITY_DATA);
  }

  const direction = trendAnalysis.spendingDirection;
  const points = rules.trend.direction[direction];

  if (points === undefined) {
    // Unknown direction label — e.g. analyzer and rules config drifted
    return emptyResult(REASONS.UNKNOWN_DIRECTION);
  }

  const normalizedScore = Number(((points / rules.trend.maxScore) * 100).toFixed(2));

  return {
    score: points,
    maxScore: rules.trend.maxScore,
    normalizedScore, // 0-100, safe to combine/compare with other score modules
    reason: null,
    breakdown: {
      direction,
      strength: trendAnalysis.spendingDirectionStrength ?? null,
      dailyChange: trendAnalysis.dailyTrend?.percentageChange ?? null,
      weeklyChange: trendAnalysis.weeklyTrend?.percentageChange ?? null,
      monthlyChange: trendAnalysis.monthlyTrend?.percentageChange ?? null,
      quarterlyChange: trendAnalysis.quarterlyTrend?.percentageChange ?? null,
    },
  };
};

module.exports = { calculateTrendScore, REASONS };