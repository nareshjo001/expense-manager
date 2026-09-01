module.exports = {
  // Weighted AVERAGE of each module's normalizedScore (0-100) — sums to
  weights: {
    budget: 25,
    spending: 15,
    trend: 15,
    habit: 20,
    category: 15,
    stability: 10,
  },

  riskLevels: [
    { min: 80, label: "Low", color: "green" },
    { min: 60, label: "Moderate", color: "yellow" },
    { min: 40, label: "High", color: "orange" },
    { min: 0, label: "Critical", color: "red" },
  ],

  stability: {
    maxScore: 10,
    weekendBalanced: { min: 0.8, max: 1.2 },
  },

  // Centralized — previously scattered as magic numbers across
  // generateStrengths/Weaknesses/Recommendations.
  insightThresholds: {
    microSpendingLow: 10,
    microSpendingHigh: 20,
    impulseSpendingLow: 20,
    impulseSpendingHigh: 35,
    categoryConcentrationLow: 35,
    categoryConcentrationHigh: 50,
    subscriptionCountHigh: 8,
  },
};