module.exports = {
  category: {
    // Based on the TOP single category's share of total spend.
    concentrationPenalty: [
      { max: 30, score: 15, label: "Diversified" },
      { max: 45, score: 12, label: "Balanced" },
      { max: 60, score: 8, label: "Concentrated" },
      { max: Infinity, score: 4, label: "HighlyConcentrated" },
    ],
 
    // Best-case tier score, kept explicit so normalizedScore stays
    // stable even if tiers get re-tuned later.
    maxScore: 15,
  },
};
