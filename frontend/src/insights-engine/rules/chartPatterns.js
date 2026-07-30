import { findPercentChanges } from "../statistics/statsCalculation";

// Chart-insight business rules: trend direction/volatility for line charts, budget pressure/concentration for bar charts, and share concentration for pie charts.
export const lineChartFinding = (data = []) => {

  const values = data.map(d => d.total);
  const n = values.length;
  let isEnoughData = true;

  if (n < 2) {
    isEnoughData = false;
    return {
        type: "LINE_CHART_SUMMARY",
        payload: {
            isEnoughData,
            text: "Keep tracking to build a clearer picture of your spending patterns over time",
        },
    }
  }

  const deltas = findPercentChanges(values);

  if (deltas.length === 0) {
    isEnoughData = false;
    return {
        type: "LINE_CHART_SUMMARY",
        payload: {
            isEnoughData,
            text: "Your spending stayed at similar levels during this period.",
        },   
    }
  }

  const MOVEMENT_THRESHOLD = 0.15;

  const up = deltas.filter(d => d > MOVEMENT_THRESHOLD).length;
  const down = deltas.filter(d => d < -MOVEMENT_THRESHOLD).length;

  let direction = "flat";
  if (up > down) direction = "up";
  else if (down > up) direction = "down";

  const avgChange =
    deltas.reduce((s, d) => s + Math.abs(d), 0) / deltas.length;

  const VOLATILITY_THRESHOLD = 0.3;

  const isVolatile = avgChange >= VOLATILITY_THRESHOLD;

  // Momentum looks only at the last 3 data points, and only if all 3 move the same direction.
  const recent = deltas.slice(-3);
  let ending = "stable";

    if (recent.length >= 3) {
      if (recent.every(d => d > MOVEMENT_THRESHOLD)) ending = "rising";
      else if (recent.every(d => d < -MOVEMENT_THRESHOLD)) ending = "falling";
    }

    return {
        type: "LINE_CHART_SUMMARY",
        payload: {
            isEnoughData,
            ending,
            isVolatile,
            direction,
        },
    }
};

export const barChartFinding = (data =[], filter = '') => {
  
  const values = data.map(d => d.total);
  const n = values.length;
  let isEnoughData = true;

  if (n < 2) {
    isEnoughData = false;
    return {
        filter,
        type: "BAR_CHART_SUMMARY",
        payload: {
            isEnoughData,
            text: "Keep tracking to build a clearer picture of your spending patterns over time",
        },
    }
  }

  if(filter === 'bymonth') {
    const usageRatios = data
      .filter(d => Number(d.budget || 0) > 0)
      .map(d =>
        Number(d.total || 0) /
        Number(d.budget || 1)
      );

    const n = usageRatios.length;
    const overspends = usageRatios.filter(r => r > 1);
    const pressureMonths = usageRatios.filter(r => r >= 0.85 && r <= 1);

    const overspendRate = overspends.length / n;
    const avgUsage = usageRatios.reduce((a, b) => a + b, 0) / n;
    const maxUsage = Math.max(...usageRatios);

    const budgetOverrun = (n >= 4 && overspendRate >= 0.3) || maxUsage >= 1.2;
    const budgetPressure = avgUsage >= 0.85 || pressureMonths.length / n >= 0.5;

    return {
      filter,
      type: "BAR_CHART_SUMMARY",
      payload: {
        filter,
        isEnoughData,
        budgetOverrun,
        budgetPressure
      }
    }
  } 

  if(filter === 'bycategory') {
      const totals = data.map(d => d.total);
      const overall = totals.reduce((a, b) => a + b, 0);
      const shares = totals.map(t => t / overall);
      const sortedShares = [...shares].sort((a, b) => a - b);

      const gini =sortedShares.reduce(
          (sum, value, i) =>
            sum +
            ((2 * (i + 1)) - sortedShares.length - 1) * value, 0) / sortedShares.length;

      const sorted = [...data].sort((a, b) => b.total - a.total);
      const top = sorted[0];
      const expectedShare = 1 / data.length;
      const dominanceRatio = (top.total / overall) / expectedShare;

      const highSpendConcentration = dominanceRatio >= 2.5 || gini >= 0.45;
      const moderateSpendConcentration = dominanceRatio >= 1.8 || gini >= 0.35;

      return {
        type: "BAR_CHART_SUMMARY",
        payload: {
          filter,
          isEnoughData,
          highSpendConcentration,
          moderateSpendConcentration,
          category: top.category,
          topSharePercent: Number(((top.total / overall) * 100).toFixed(1)),
        }
      }
  }
};

export const pieChartFinding = (data =[], filter = '') => {
  if (data.length < 2) {
    return {
      type: "PIE_CHART_SUMMARY",
      payload: {
        isEnoughData: false,
        text: "Keep tracking to build a clearer picture of your spending patterns over time",
      },
    };
  }

  if (filter === "comparison") {
    const budget = data.find(d => d.category === "Budget")?.total || 0;
    const spent = data.find(d => d.category === "Spent")?.total || 0;

    if (budget === 0) return null;

    const ratio = spent / budget;

    return {
      type: "PIE_CHART_SUMMARY",
      payload: {
        isEnoughData: true,
        filter,
        ratio,
      },
    };
  }

  const totals = data.map(d => d.total);
  const overall = totals.reduce((a, b) => a + b, 0);
  if (overall === 0) return null;

  const shares = totals.map(t => t / overall);
  const n = shares.length;

  // Gini coefficient
  const sortedShares = [...shares].sort((a, b) => a - b);
  const gini = sortedShares.reduce(
      (sum, value, i) =>
        sum +
        ((2 * (i + 1)) - sortedShares.length - 1) * value, 0) / sortedShares.length;

  const sorted = [...data].sort((a, b) => b.total - a.total);
  const top = sorted[0];

  const expectedShare = 1 / n;
  const dominanceRatio = (top.total / overall) / expectedShare;

  const highConcentration = dominanceRatio >= 2.5 || gini >= 0.45;

  const moderateConcentration = !highConcentration && (dominanceRatio >= 1.8 || gini >= 0.35);

  return {
    type: "PIE_CHART_SUMMARY",
    payload: {
      isEnoughData: true,
      filter,              // "AMOUNT" | "COUNT"
      category: top.category,
      highConcentration,
      moderateConcentration,
      topSharePercent: Number(((top.total / overall) * 100).toFixed(1)),
    },
  };
}