import { detectExpenseAnomaly } from "../knowledge/anomalyDetection";
import { buildWeeklyBaseline } from "../learning/thresholdAdapter/buildWeeklyBaseline";

// Compares this week's spend to last week's using a volatility-adaptive threshold, and flags an anomaly source when the change is significant.
export const overallSpend = ({
  expenses = [],
  previousExpenses = [],
  weeklyData = [],
  scope,
}) => {
  if (!Array.isArray(expenses) || expenses.length === 0) {
    return null;
  }

  const baseline = buildWeeklyBaseline(weeklyData);
  const ADAPTIVE_THRESHOLD =
    baseline?.mean > 0
      ? Math.max(
          0.25,
          Math.min(
            0.6,
            baseline.volatility
          )
        )
      : 0.3;

  const totalSpent = expenses.reduce(
    (sum, exp) => sum + Number(exp.expenseAmount || 0),
    0
  );

  if (!previousExpenses.length) {
    return {
      type: "LAST_7_DAYS_SUMMARY",
      payload: {
        totalSpent,
        differenceAmount: null,
        anomalyContext: null,
        anomalySource: null,
      },
    };
  }

  const previousTotalSpent = previousExpenses.reduce(
    (sum, exp) => sum + Number(exp.expenseAmount || 0),
    0
  );

  const differenceAmount = totalSpent - previousTotalSpent;

  const changeRatio =
    previousTotalSpent > 0
      ? Math.abs(differenceAmount) / previousTotalSpent
      : 0;

  let anomalyContext = null;
  let anomalySource = null;

  if (changeRatio >= ADAPTIVE_THRESHOLD) {
    if (differenceAmount > 0) {
      // Increase → inspect THIS week
      anomalyContext = detectExpenseAnomaly(expenses, totalSpent);
      anomalySource = anomalyContext ? "CURRENT_WEEK" : null;
    } else {
      // Decrease → inspect LAST week
      anomalyContext = detectExpenseAnomaly(
        previousExpenses,
        previousTotalSpent
      );
      anomalySource = anomalyContext ? "PREVIOUS_WEEK" : null;
    }
  }
  
  return {
    type: "LAST_7_DAYS_SUMMARY",
    payload: {
      totalSpent,
      differenceAmount,
      anomalyContext,
      anomalySource,
    },
  };
};