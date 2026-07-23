/**
 * Known limitation (intentionally not solved here): a single large but
 * legitimate recurring cost (rent, annual insurance) still raises CV.
 * Distinguishing "recurring big fixed cost" from "erratic spending"
 * needs recurring-expense detection — a good candidate for a later
 * module, not something this score should silently pretend to solve.
*/

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