// Centralized, frozen V1 thresholds for expenseAnomalyAnalyzer.js -- nothing in the analyzer hardcodes a number that belongs here (same convention as spendingRules.js/categoryRules.js/habitRules.js). V1 is deliberately a single, explainable statistical rule: robust (median/MAD) detection per exact stored category, upper-tail only, with a degenerate-MAD fallback -- no IQR, no learned thresholds, no probabilistic language. Every object/nested object/array below is deep-frozen so a caller can never mutate a threshold, formula constant, severity label, limit, or reason code and have it silently affect later analyzer runs -- no value is changed here, only the freezing wrapper.
const anomaly = {
  // A category is only evaluated once it has at least this many valid, same-category, in-window historical records -- below this, dispersion estimates aren't defensible, and there is no overall-user fallback.
  minBaselineSampleSize: 10,

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
    threshold: 4.0,
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
