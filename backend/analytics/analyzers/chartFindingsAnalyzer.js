// ANL-001-T03 -- server-side ChartFindings packaging for ANL-001-T02,
// replacing frontend/src/insights-engine (chartPatterns.js) line/bar/pie
// "finding" synthesis. This does no new math -- it reshapes values already
// computed by trendAnalyzer.js, budgetAnalyzer.js and categoryAnalyzer.js
// into a per-chart-type shape the line/bar/pie chart components consume.

// Concentration indexes/ratios from categoryAnalyzer.js are 0-100 percentages;
// chart consumers want a 0-1 ratio.
const toRatio = (percentage) =>
  typeof percentage === "number" ? Math.round((percentage / 100) * 10000) / 10000 : null;

const buildLineFindings = (trendReport = {}) => {
  if (!trendReport.hasData) {
    return { hasData: false, direction: null, volatility: null };
  }

  return {
    hasData: true,
    direction: trendReport.monthlyTrend?.direction ?? null,
    volatility:
      typeof trendReport.spendingDirectionStrength === "number"
        ? trendReport.spendingDirectionStrength
        : null,
  };
};

const buildBarFindings = (budgetReport = {}, categoryReport = {}) => {
  if (budgetReport.hasBudget !== true) {
    return { hasData: false, pressureCategory: null, concentrationRatio: null };
  }

  return {
    hasData: true,
    pressureCategory: budgetReport.status ?? null,
    concentrationRatio: toRatio(categoryReport.top3Concentration),
  };
};

const buildPieFindings = (categoryReport = {}) => {
  if (!categoryReport.hasData) {
    return { hasData: false, concentrationRatio: null, topSlice: null };
  }

  return {
    hasData: true,
    concentrationRatio: toRatio(categoryReport.concentrationIndex),
    topSlice: categoryReport.topCategory?.category ?? null,
  };
};

const analyze = ({ trendReport = {}, budgetReport = {}, categoryReport = {} } = {}) => {
  return {
    line: buildLineFindings(trendReport),
    bar: buildBarFindings(budgetReport, categoryReport),
    pie: buildPieFindings(categoryReport),
  };
};

module.exports = {
  toRatio,
  buildLineFindings,
  buildBarFindings,
  buildPieFindings,
  analyze,
};
