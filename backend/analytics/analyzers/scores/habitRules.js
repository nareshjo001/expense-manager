module.exports = {
  habits: {
    microSpending: {
      minimumSampleSize: 5,
      floorAmount: 50,
      // Threshold = max(floorAmount, median expense * this multiplier).
      medianMultiplier: 0.18,
    },
 
    impulseSpending: {
      // Judgment call, worth revisiting against your real category
      categories: ["Shopping", "Entertainment", "Food", "Personal Care"],
    },
 
    impulseTiers: [
      { max: 15, score: 10, label: "LowImpulse" },
      { max: 30, score: 6, label: "ModerateImpulse" },
      { max: Infinity, score: 2, label: "HighImpulse" },
    ],
 
    microSpendingTiers: [
      { max: 10, score: 5, label: "LowMicroSpend" },
      { max: 20, score: 3, label: "ModerateMicroSpend" },
      { max: Infinity, score: 1, label: "HighMicroSpend" },
    ],
 
    // Weekend-skew only, not symmetric deviation from 1.0 — intentional.
    weekendRatio: {
      balancedMax: 1.2,
      scores: { balanced: 5, unbalanced: 2 },
    },
 
    // Both penalties below scale with how far past the threshold the
    subscriptionPenalty: {
      threshold: 8,
      perExtra: 0.75,
      maxPenalty: 6,
    },
 
    shoppingFrequencyPenalty: {
      threshold: 15,
      perExtra: 0.3,
      maxPenalty: 4,
    },
 
    maxScore: 20, // 10 (impulse) + 5 (micro) + 5 (weekendRatio)
  },
};