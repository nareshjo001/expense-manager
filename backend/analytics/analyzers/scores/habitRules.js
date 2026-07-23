module.exports = {
  habits: {
    microSpending: {
      minimumSampleSize: 5,
      floorAmount: 50,
      // Threshold = max(floorAmount, median expense * this multiplier).
      // Median, not mean — one large one-off bill (rent, insurance)
      // shouldn't drag the "typical" expense size up and silently
      // reclassify what counts as "micro" that month.
      medianMultiplier: 0.18,
    },
 
    impulseSpending: {
      // Judgment call, worth revisiting against your real category
      // taxonomy: "Food" here means ALL food spend, including
      // groceries, which are a necessity, not an impulse buy. If you
      // can distinguish "Dining Out"/"Food Delivery" from "Groceries,"
      // only the discretionary one belongs here.
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
    // Weekday spend tends to be necessity-driven (commute, lunch);
    // weekend spend is more discretionary, so this specifically flags
    // weekend OVERspend rather than penalizing being weekday-heavy too.
    weekendRatio: {
      balancedMax: 1.2,
      scores: { balanced: 5, unbalanced: 2 },
    },
 
    // Both penalties below scale with how far past the threshold the
    // user is, instead of a flat cliff-edge deduction (8 subscriptions
    // = 0 penalty, 9 = full penalty was the original behavior).
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