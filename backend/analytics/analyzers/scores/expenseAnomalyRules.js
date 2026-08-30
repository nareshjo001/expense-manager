// Centralized, frozen thresholds for expenseAnomalyAnalyzer.js -- robust
// median/MAD upper-tail detection against matching-name history when possible,
// otherwise the normalized category, followed by a monthly materiality gate.
const anomaly = {
  // A category is only evaluated once it has at least this many valid, same-category, in-window historical records -- below this, dispersion estimates aren't defensible, and there is no overall-user fallback.
  minBaselineSampleSize: 10,

  // Prefer a narrower comparison against the same normalized expense name
  // when it has enough history. This prevents broad categories such as
  // Food from comparing every restaurant meal with every snack.
  minNameBaselineSampleSize: 4,

  // How far back (in complete calendar months, ending the instant before
  // the current month starts) baseline records are drawn from.
  baselineWindowMonths: 12,

  modifiedZ: Object.freeze({
    // 0.6745 makes the modified z-score comparable to a normal-distribution z-score when using MAD instead of standard deviation.
    constant: 0.6745,
    threshold: 3.5,
    // Both the deviation test AND a plain magnitude test must pass -- guards against a tiny median making an ordinary amount look like an extreme deviation in z-score terms alone.
    minAmountRatio: 2.0,
  }),

  // Used only when the category's baseline MAD is exactly 0 (a fixed monthly subscription, e.g.) and the median is positive, avoiding the modified z-score's division by zero entirely rather than guarding ad hoc.
  medianRatio: Object.freeze({
    // Keep the same plain-magnitude floor used by the MAD branch. A zero
    // MAD must not make the detector suddenly twice as permissive/strict.
    threshold: 2.0,
  }),

  materiality: Object.freeze({
    // Only surface the portion above the usual amount when that excess is
    // meaningful relative to this month's budget, or the user's median
    // active-month spending when no budget exists.
    minExcessToMonthlyReferenceRatio: 0.05,
  }),

  // thresholdMultiple = methodScore / methodThreshold; flagged items are always >= 1.0 by construction, so the lowest tier's lower bound is implicit. Ordered ascending by `max`; the first tier where thresholdMultiple is strictly less applies -- same "first matching tier" shape as spendingRules.js's stabilityTiers.
  severityTiers: Object.freeze([
    Object.freeze({ max: 1.5, label: "moderate" }),
    Object.freeze({ max: 2.5, label: "high" }),
    Object.freeze({ max: Infinity, label: "very_high" }),
  ]),

  maxAnomalies: 10,

  // V1 has exactly one detection reason -- a second reasonCode is not introduced speculatively.
  reasonCode: "CATEGORY_AMOUNT_SPIKE",
};

module.exports = Object.freeze({
  anomaly: Object.freeze(anomaly),
});
