// Shared robust-trend math for the forecasting layer, extracted from forecastAnalyzer.js (which still re-exports fitRobustTrend) so the overall forecast and per-category breakdown use the literal same function instead of two copies that could drift apart. Pure and deterministic -- no I/O, no `new Date()`, no randomness, no mutation of inputs.
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

// Theil-Sen robust linear trend: fits total ≈ intercept + slope*ordinal over `points` (ordinal is a real calendar-month ordinal, never an array index, so gaps are visible). `slope` is the median of all pairwise slopes so one outlier can't dominate the fit like least squares; `residualMad` is the fit's uncertainty measure. Degenerate 0/1-point inputs return a flat zero-slope line rather than throwing.
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
