module.exports = {
  budget: {
    utilizationTiers: [
      { max: 50, score: 35, label: "Excellent" },
      { max: 70, score: 30, label: "Good" },
      { max: 90, score: 20, label: "Caution" },
      { max: 100, score: 10, label: "AtLimit" },
      { max: Infinity, score: 0, label: "Overspent" },
    ],
 
    streakTiers: [
      { min: 12, score: 15, label: "Elite" },
      { min: 6, score: 10, label: "Strong" },
      { min: 3, score: 5, label: "Building" },
      { min: 0, score: 0, label: "None" },
    ],
 
    // Penalty scales with HOW BAD the projected overspend is (as a % of budget), not a flat deduction.
    projectedOverspendPenalty: {
      maxPenalty: 20,
      penaltyScale: 40,
    },
 
    // Sum of best-case tier scores. Kept as an explicit constant (not
    maxScore: 50,
  },
}; 