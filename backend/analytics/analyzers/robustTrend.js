// Shared robust-trend math for the forecasting layer.
//
// Extracted (Prediction Layer V1) from forecastAnalyzer.js purely so the
// overall forecast and the per-category breakdown can use the LITERAL SAME
// trend function instead of two look-alike copies that could drift apart.
// The arithmetic below is byte-for-byte the V2 implementation
// forecastAnalyzer.js already shipped -- this extraction changed no
// formula, no constant and no rounding behavior. forecastAnalyzer.js still
// re-exports `fitRobustTrend` from its own module surface, so every
// existing importer and test keeps working unchanged.
//
// Pure and deterministic: no I/O, no `new Date()`, no randomness, no
// mutation of inputs.
"use strict";

const median = (numbers) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const medianAbsoluteDeviation = (numbers, numbersMedian) => {
  const deviations = numbers.map((n) => Math.abs(n - numbersMedian));
  return median(deviations);
};

/**
 * Theil-Sen robust linear trend: fits `total ≈ intercept + slope * ordinal`
 * over `points` (`{ ordinal, total }`, ascending by `ordinal` -- a real
 * calendar-month ordinal, NEVER an array index, so a gap between observed
 * months is arithmetically visible: January -> March is 2 months apart).
 *
 * `slope` is the median of the slopes between every pair of points, so a
 * single outlier month can only ever be an endpoint of O(n) of the O(n^2)
 * pairs and cannot dominate the fit the way it would dominate least
 * squares. `intercept` is the median residual against that slope.
 * `residualMad` is the median absolute deviation of the fitted line's
 * residuals -- the forecast's uncertainty measure.
 *
 * Degenerate cases (0 or 1 point) return a flat, zero-slope line rather
 * than throwing. Callers gate on their own minimum-history rules before
 * this matters in practice. Every pair has a distinct ordinal by
 * construction (callers merge same-ordinal entries first), so no pairwise
 * division by zero is possible.
 */
function fitRobustTrend(points) {
  const n = points.length;

  if (n === 0) {
    return { slope: 0, intercept: 0, residualMad: 0 };
  }
  if (n === 1) {
    return { slope: 0, intercept: points[0].total, residualMad: 0 };
  }

  const slopes = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      slopes.push((points[j].total - points[i].total) / (points[j].ordinal - points[i].ordinal));
    }
  }
  const slope = median(slopes);

  const residualsAgainstSlope = points.map((point) => point.total - slope * point.ordinal);
  const intercept = median(residualsAgainstSlope);

  const residuals = points.map((point) => point.total - (intercept + slope * point.ordinal));
  const residualMedian = median(residuals);
  const residualMad = medianAbsoluteDeviation(residuals, residualMedian);

  return { slope, intercept, residualMad };
}

module.exports = {
  median,
  medianAbsoluteDeviation,
  fitRobustTrend,
};
