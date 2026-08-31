// Current running-month nowcast. Every already-logged expense remains in
// spentSoFar; robustly adjusted values influence only the unobserved days.
"use strict";

const categoryForecastAllocator = require("./categoryForecastAllocator");
const forecastBudgetRisk = require("./forecastBudgetRisk");
const { fitRobustTrend } = require("./robustTrend");
const { forecast: RULES } = require("./scores/forecastRules");

const round2 = (value) => Number(Number(value).toFixed(2));
const median = (values) => {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const monthLabel = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

function sanitizeMonthlySeries(monthlySeries) {
  const byOrdinal = new Map();
  (Array.isArray(monthlySeries) ? monthlySeries : []).forEach((entry) => {
    const match = typeof entry?.monthKey === "string" ? /^(-?\d+)-(\d+)$/.exec(entry.monthKey) : null;
    const amount = Number(entry?.totalAmount);
    if (!match || !Number.isFinite(amount)) return;
    const ordinal = Number(match[1]) * 12 + Number(match[2]);
    if (!Number.isFinite(ordinal)) return;
    byOrdinal.set(ordinal, (byOrdinal.get(ordinal) ?? 0) + amount);
  });
  return [...byOrdinal.entries()]
    .map(([ordinal, total]) => ({ ordinal, total }))
    .sort((a, b) => a.ordinal - b.ordinal)
    .slice(-RULES.maxHistoryMonths);
}

function qualityFor(points) {
  const warnings = [];
  if (points.length < RULES.dataQuality.sufficientCompletedMonths) {
    warnings.push(RULES.dataQuality.warnings.limitedHistory);
  }
  if (points.length >= 2 && points.at(-1).ordinal - points[0].ordinal + 1 > points.length) {
    warnings.push(RULES.dataQuality.warnings.historyGaps);
  }
  return {
    status:
      points.length >= RULES.dataQuality.sufficientCompletedMonths
        ? RULES.dataQuality.statuses.sufficient
        : RULES.dataQuality.statuses.limited,
    completedMonths: points.length,
    method: RULES.currentMonth.methodVersion,
    warnings,
  };
}

function analyze({ input, currentMonthStart, currentMonthBudget } = {}) {
  const validAnchor = currentMonthStart instanceof Date && !Number.isNaN(currentMonthStart.getTime());
  const safe = input && typeof input === "object" ? input : {};
  const spentSoFar = Number.isFinite(safe.spentSoFar) ? safe.spentSoFar : 0;
  const targetMonth = validAnchor ? monthLabel(currentMonthStart) : null;
  
  const unavailable = (historyMonthsUsed = 0) => ({
    hasData: false,
    reasonCode: RULES.currentMonth.reasonCodes.insufficientHistory,
    method: RULES.currentMonth.methodVersion,
    targetMonth,
    asOfDate: safe.asOfDate ?? null,
    spentSoFar: round2(spentSoFar),
    expectedRemaining: null,
    estimate: null,
    range: null,
    historyMonthsUsed,
    categories: [],
    budgetRisk: forecastBudgetRisk.evaluate({ predictedTotal: null, targetMonthBudget: currentMonthBudget }),
    adjustments: { historical: [], current: [] },
  });
  if (!validAnchor) return unavailable();

  const points = sanitizeMonthlySeries(safe.monthlySeries);
  if (points.length < RULES.currentMonth.minHistoryMonths) return unavailable(points.length);
  const { slope, intercept, residualMad } = fitRobustTrend(points);
  const anchorOrdinal = currentMonthStart.getFullYear() * 12 + currentMonthStart.getMonth();
  const baselineEstimate = Math.max(0, intercept + slope * anchorOrdinal);
  const baselineSpread = residualMad * RULES.madScaleConstant;
  const baseline = {
    estimate: baselineEstimate,
    range: {
      lower: Math.max(0, baselineEstimate - baselineSpread),
      upper: Math.max(0, baselineEstimate + baselineSpread),
    },
  };

  const completionRatio = median(
    (Array.isArray(safe.completionRatios) ? safe.completionRatios : []).filter(
      (value) => Number.isFinite(value) && value > 0 && value <= 1
    )
  );
  const elapsedDay = Number.isFinite(safe.elapsedDay) ? safe.elapsedDay : 1;
  const daysInMonth = Number.isFinite(safe.daysInMonth) && safe.daysInMonth > 0 ? safe.daysInMonth : 30;
  const progress = Math.min(1, Math.max(0, elapsedDay / daysInMonth));
  const paceWeight = Math.min(
    RULES.currentMonth.maxPaceWeight,
    Math.max(RULES.currentMonth.minPaceWeight, progress)
  );
  const forecastableSpent = Number.isFinite(safe.forecastableSpentSoFar)
    ? safe.forecastableSpentSoFar
    : spentSoFar;
  const paceEstimate = completionRatio ? forecastableSpent / completionRatio : baseline.estimate;
  const routineEstimate = Math.max(
    forecastableSpent,
    baseline.estimate * (1 - paceWeight) + paceEstimate * paceWeight
  );
  const expectedRemaining = Math.max(0, routineEstimate - forecastableSpent);
  const estimate = Math.max(spentSoFar, spentSoFar + expectedRemaining);

  const baselineLower = Number.isFinite(baseline.range?.lower) ? baseline.range.lower : baseline.estimate;
  const baselineUpper = Number.isFinite(baseline.range?.upper) ? baseline.range.upper : baseline.estimate;
  const paceSpread = Math.abs(paceEstimate - baseline.estimate);
  const remainingUncertainty = (1 - progress) * paceSpread;
  const translatedLower = spentSoFar + Math.max(0, baselineLower - forecastableSpent - remainingUncertainty);
  const translatedUpper = spentSoFar + Math.max(0, baselineUpper - forecastableSpent + remainingUncertainty);
  const range = {
    lower: round2(Math.min(estimate, Math.max(spentSoFar, translatedLower))),
    upper: round2(Math.max(estimate, translatedUpper)),
  };

  const remainingAllocation = expectedRemaining > 0
    ? categoryForecastAllocator.allocate({
        categorySeries: safe.categorySeries,
        predictedTotal: expectedRemaining,
        anchorOrdinal: currentMonthStart.getFullYear() * 12 + currentMonthStart.getMonth(),
      })
    : { categories: [] };
  const remainingByCategory = new Map(
    (remainingAllocation.categories ?? []).map((entry) => [entry.category, entry])
  );
  const actualByCategory = new Map(
    (Array.isArray(safe.currentCategoryActuals) ? safe.currentCategoryActuals : [])
      .filter((entry) => entry && typeof entry.category === "string" && Number.isFinite(entry.amount))
      .map((entry) => [entry.category, entry.amount])
  );
  const categoryNames = new Set([...actualByCategory.keys(), ...remainingByCategory.keys()]);
  const categories = [...categoryNames]
    .map((category) => {
      const actualAmount = actualByCategory.get(category) ?? 0;
      const remaining = remainingByCategory.get(category);
      const categoryExpectedRemaining = remaining?.predictedAmount ?? 0;
      const projectedAmount = actualAmount + categoryExpectedRemaining;
      return {
        category,
        actualAmount: round2(actualAmount),
        expectedRemaining: round2(categoryExpectedRemaining),
        projectedAmount: round2(projectedAmount),
        sharePercentage: estimate > 0 ? round2((projectedAmount / estimate) * 100) : 0,
        method: remaining?.method ?? "ACTUAL_ONLY",
      };
    })
    .sort((a, b) => b.projectedAmount - a.projectedAmount || a.category.localeCompare(b.category));

  const historicalAdjustments = Array.isArray(safe.historicalAdjustments) ? safe.historicalAdjustments : [];
  const currentAdjustments = Array.isArray(safe.currentAdjustments) ? safe.currentAdjustments : [];
  const result = {
    hasData: true,
    reasonCode: null,
    method: RULES.currentMonth.methodVersion,
    targetMonth,
    asOfDate: safe.asOfDate ?? null,
    spentSoFar: round2(spentSoFar),
    expectedRemaining: round2(expectedRemaining),
    estimate: round2(estimate),
    range,
    historyMonthsUsed: points.length,
    completionRatio: completionRatio === null ? null : round2(completionRatio * 100),
    dataQuality: qualityFor(points),
    categories,
    budgetRisk: forecastBudgetRisk.evaluate({ predictedTotal: round2(estimate), targetMonthBudget: currentMonthBudget }),
    adjustments: {
      historical: historicalAdjustments,
      current: currentAdjustments,
      historicalExcludedAmount: round2(
        historicalAdjustments.reduce((sum, item) => sum + (Number(item?.excludedAmount) || 0), 0)
      ),
      currentNotExtrapolatedAmount: round2(
        currentAdjustments.reduce((sum, item) => sum + (Number(item?.excludedAmount) || 0), 0)
      ),
    },
  };

  return result;
}


module.exports = { analyze };
