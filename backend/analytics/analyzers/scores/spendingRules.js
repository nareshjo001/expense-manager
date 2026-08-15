// Known limitation (intentionally unsolved): a single large legitimate recurring cost (rent, insurance) still raises CV; needs future recurring-expense detection to distinguish from erratic spending.

module.exports = {
  spending: {
    stabilityTiers: [
      { max: 0.3, score: 20, label: "VeryStable" },
      { max: 0.6, score: 15, label: "Stable" },
      { max: 1.0, score: 10, label: "Moderate" },
      { max: 1.5, score: 5, label: "Volatile" },
      { max: Infinity, score: 0, label: "HighlyVolatile" },
    ],
 
    // Below this many tracked days, weekly buckets are too few for CV
    // to mean anything — a single purchase can swing it wildly.
    minimumTrackingDaysForStability: 14,
 
    maxScore: 20,
  },
};