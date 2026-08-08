const rules = require("../scores/habitRules");

const REASONS = { NO_EXPENSE_DATA: "NO_EXPENSE_DATA" };

const emptyResult = (reason) => ({
  score: null,
  maxScore: rules.habits.maxScore,
  normalizedScore: null,
  reason,
  breakdown: null,
});

const findTier = (tiers, value) => tiers.find((t) => value <= t.max) || tiers[tiers.length - 1];

const calculateHabitScore = (habits = {}) => {
  // Zero expenses must never look like a PERFECT habits score — it
  // means there's no evidence either way, not that habits are good.
  if (habits.hasData === false) {
    return emptyResult(REASONS.NO_EXPENSE_DATA);
  }

  // Resolve amountSharePercentage first, falling through to
  // transactionSharePercentage only when amountSharePercentage itself is
  // not a usable value -- checked per-field with an explicit finite test,
  // not a single nullish-coalesce over both fields. `??` only skips
  // null/undefined, so a NaN or Infinity amountSharePercentage would
  // otherwise "win" the coalesce and silently discard a perfectly valid
  // transactionSharePercentage fallback.
  const isFiniteShare = (value) =>
    typeof value === "number" && Number.isFinite(value);

  const amountRaw = habits.impulseSpending?.amountSharePercentage;
  const transactionRaw = habits.impulseSpending?.transactionSharePercentage;

  // Distinguish "no evaluable impulse share" from a genuine evaluated
  // 0% — an absent/non-finite value must not fall into the same
  // LowImpulse tier a real, confirmed zero would earn.
  let impulseValue;
  if (isFiniteShare(amountRaw)) {
    impulseValue = Number(amountRaw);
  } else if (isFiniteShare(transactionRaw)) {
    impulseValue = Number(transactionRaw);
  } else {
    impulseValue = null;
  }

  let impulseTier;
  if (impulseValue === null) {
    impulseTier = { score: 0, label: "InsufficientData" };
  } else {
    impulseTier = findTier(rules.habits.impulseTiers, impulseValue);
  }

  const microRaw = habits.microSpending?.contributionPercentage;
  const microValue = Number.isFinite(Number(microRaw)) ? Number(microRaw) : 0;
  const microTier = findTier(rules.habits.microSpendingTiers, microValue);

  const ratio = habits.weekendVsWeekday?.weekendRatio;
  let weekendPoints;
  let weekendLabel;
  if (ratio === null || ratio === undefined) {
    // Not enough weekend/weekday data to judge — neutral, not a
    // guessed "balanced" default that silently rewards missing data.
    weekendPoints = 0;
    weekendLabel = "InsufficientData";
  } else if (ratio <= rules.habits.weekendRatio.balancedMax) {
    weekendPoints = rules.habits.weekendRatio.scores.balanced;
    weekendLabel = "Balanced";
  } else {
    weekendPoints = rules.habits.weekendRatio.scores.unbalanced;
    weekendLabel = "WeekendHeavy";
  }

  const subscriptionCount = Number(habits.subscriptionPattern?.totalSubscriptions) || 0;
  let subscriptionPenalty = 0;
  if (subscriptionCount > rules.habits.subscriptionPenalty.threshold) {
    const excess = subscriptionCount - rules.habits.subscriptionPenalty.threshold;
    subscriptionPenalty = Math.min(
      rules.habits.subscriptionPenalty.maxPenalty,
      excess * rules.habits.subscriptionPenalty.perExtra
    );
  }

  const shoppingCount = Number(habits.shoppingFrequency?.shoppingTransactions) || 0;
  let shoppingPenalty = 0;
  if (shoppingCount > rules.habits.shoppingFrequencyPenalty.threshold) {
    const excess = shoppingCount - rules.habits.shoppingFrequencyPenalty.threshold;
    shoppingPenalty = Math.min(
      rules.habits.shoppingFrequencyPenalty.maxPenalty,
      excess * rules.habits.shoppingFrequencyPenalty.perExtra
    );
  }

  const rawScore =
    impulseTier.score + microTier.score + weekendPoints - subscriptionPenalty - shoppingPenalty;
  const clampedScore = Math.max(0, Math.min(rules.habits.maxScore, rawScore));
  const normalizedScore = Number(((clampedScore / rules.habits.maxScore) * 100).toFixed(2));

  return {
    score: Number(clampedScore.toFixed(2)),
    maxScore: rules.habits.maxScore,
    normalizedScore,
    reason: null,
    breakdown: {
      impulse: { value: impulseValue, tier: impulseTier.label, points: impulseTier.score },
      microSpending: { value: microValue, tier: microTier.label, points: microTier.score },
      weekendRatio: { value: ratio ?? null, tier: weekendLabel, points: weekendPoints },
      subscriptionPenalty: Number(subscriptionPenalty.toFixed(2)),
      shoppingPenalty: Number(shoppingPenalty.toFixed(2)),
    },
  };
};

module.exports = { 
  calculateHabitScore, 
  REASONS 
};