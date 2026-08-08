// Centralized, frozen V1 thresholds for expenseAnomalyAnalyzer.js. Nothing
// in the analyzer hardcodes a number that belongs here -- matching the
// convention already used by spendingRules.js / categoryRules.js / habitRules.js.
//
// V1 is deliberately a single, explainable statistical rule: robust
// (median/MAD) detection per exact stored category, upper-tail only, with a
// degenerate-MAD fallback. No IQR, no learned thresholds, no probabilistic
// language -- see SIA_Implementation_Blueprint.md-adjacent design notes for
// why (median/MAD's 50% breakdown point vs. Isolation Forest/LOF's sample
// and encoding requirements).
// All constants below are a frozen contract (same convention as
// backend/sia/responseFormatter.js's Object.freeze(["none"])): every object,
// nested object, and array is deep-frozen so a caller can never mutate a
// threshold, formula constant, severity label, result limit, or reason code
// -- accidentally or otherwise -- and have that mutation silently affect
// later analyzer runs. No threshold/formula/label/limit/reasonCode value is
// changed here, only the freezing wrapper below.
const anomaly = {
  // A category is only evaluated once it has at least this many valid,
  // same-category, in-window historical (pre-current-month) records.
  // Below this, dispersion estimates are not defensible -- the category
  // is simply not evaluated, and there is no overall-user fallback.
  minBaselineSampleSize: 10,

  // How far back (in complete calendar months, ending the instant before
  // the current month starts) baseline records are drawn from.
  baselineWindowMonths: 12,

  modifiedZ: Object.freeze({
    // 0.6745 is the standard constant that makes the modified z-score
    // comparable to a normal-distribution z-score when using MAD instead
    // of standard deviation.
    constant: 0.6745,
    threshold: 3.5,
    // Both the deviation test AND a plain magnitude test must pass --
    // guards against a tiny median making an ordinary rupee amount look
    // like an extreme deviation in z-score terms alone.
    minAmountRatio: 2.0,
  }),

  // Used only when the category's baseline MAD is exactly 0 (more than
  // half the historical amounts in that category are identical -- e.g. a
  // fixed monthly subscription) and the median is positive, so the
  // modified z-score's division by zero is avoided entirely rather than
  // guarded ad hoc.
  medianRatio: Object.freeze({
    threshold: 4.0,
  }),

  // thresholdMultiple = methodScore / methodThreshold. Flagged items are
  // always >= 1.0 by construction (that's the flag condition), so the
  // lowest tier's lower bound is implicit, not a separate constant.
  // Ordered ascending by `max`; the first tier where thresholdMultiple is
  // strictly less than `max` applies -- same "first matching tier" shape
  // already used by spendingRules.js's stabilityTiers.
  severityTiers: Object.freeze([
    Object.freeze({ max: 1.5, label: "moderate" }),
    Object.freeze({ max: 2.5, label: "high" }),
    Object.freeze({ max: Infinity, label: "very_high" }),
  ]),

  maxAnomalies: 10,

  // V1 has exactly one detection reason. A second reasonCode is not
  // introduced speculatively.
  reasonCode: "CATEGORY_AMOUNT_SPIKE",
};

module.exports = Object.freeze({
  anomaly: Object.freeze(anomaly),
});
