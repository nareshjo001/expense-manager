// Maps expense-pattern findings (weekly comparison, category dominance/stability/concentration) to user-facing insight text.
export const expenseInsightTemplates = {
  LAST_7_DAYS_SUMMARY: ({
  totalSpent,
  differenceAmount,
  anomalyContext,
  anomalySource,
  }) => {
    const formatAmount = (amt) => `₹${Math.abs(amt).toLocaleString()}`;
    const amountText = `₹${totalSpent.toLocaleString()}`;

    if (differenceAmount == null) {
      return [
        {
          severity: "LOW",
          text: `You spent ${amountText} in the last 7 days.`,
        },
      ];
    }

    if (Math.abs(differenceAmount) < 50) {
      return [
        {
          severity: "LOW",
          text: `You spent ${amountText} in the last 7 days, similar to last week.`,
        },
      ];
    }

    if (anomalyContext && anomalySource === "CURRENT_WEEK") {
      return [
        {
          severity: "HIGH",
          text: `You spent ${amountText} in the last 7 days, higher than last week, mainly driven by a few larger expenses this week.`,
        },
      ];
    }

    if (anomalyContext && anomalySource === "PREVIOUS_WEEK") {
      return [
        {
          severity: "HIGH",
          text: `You spent ${amountText} in the last 7 days, lower than last week after unusually high spending in the previous week.`,
        },
      ];
    }

    const direction = differenceAmount > 0 ? "more" : "less";

    return [
      {
        severity: "MEDIUM",
        text: `You spent ${amountText} in the last 7 days, ${formatAmount(
          differenceAmount
        )} ${direction} than last week.`,
      },
    ];
  },

   THIS_MONTH_CATEGORY_SUMMARY: ({
    hasDominantCategory,
    category,
    topCategory,
    isConsistent = false,
    isModerateSpike = false,
    isStrongSpike = false,
    hasMicroTransactions = false,
    microCategory,
  }) => {
    if (!hasDominantCategory && topCategory) {
      return [
        {
          severity: "LOW",
          text: `Your highest spending category this month is ${topCategory}.`,
        },
      ];
    }

    const lines = [];
    lines.push({severity: "HIGH", text: `Most of your spending this month went toward ${category}.`});

    if (isConsistent) {
      lines.push({severity: "MEDIUM",text: `${category} have been a consistent part of your monthly spending.`});
    } else if (isModerateSpike) {
      lines.push({severity: "MEDIUM", text: `This month, ${category} spending is slightly above usual compared to recent months.`});
    } else if (isStrongSpike) {
      lines.push({severity: "HIGH", text: `This month shows a noticeable spike in ${category} spending compared to recent months.`});
    }

    if (hasMicroTransactions) {
      lines.push({severity: "MEDIUM", text: `${microCategory} contains several smaller expenses that gradually add up over time.`});
    }

    return lines;
  },

  THIS_YEAR_CATEGORY_SUMMARY: ({
    topCategory,
    topPercent,
    dominanceLevel,
    stability,
    concentration,
  }) => {
    const lines = [];

    // Dominance (always present)
    if (dominanceLevel === "Strong") {
      lines.push(
        {severity: "HIGH", text: `${topCategory} was your largest spending category this year, accounting for ${topPercent}% of your total expenses.`}
      );
    } else if (dominanceLevel === "Moderate") {
      lines.push(
        {severity: "MEDIUM", text: `${topCategory} was your largest spending category this year at ${topPercent}%, though your spending was spread across other areas as well.`}
      );
    } else {
      lines.push(
        {severity: "LOW", text: `Your spending this year was fairly balanced, with ${topCategory} being the highest category at ${topPercent}%.`}
      );
    }

    // Stability
    if (stability?.isStable) {
      if (stability.level === "HIGH") {
        lines.push(
          {severity: "MEDIUM", text: `${topCategory} spending remained consistently high across ${stability.stableMonths} months, showing a consistent long-term spending pattern.`}
        );
      } else if (stability.level === "MEDIUM") {
        lines.push(
          {severity: "LOW", text: `${topCategory} appeared regularly in your spending across ${stability.stableMonths} months, suggesting a recurring pattern.`}
        );
      }
    }

    // Concentration (optional, suppressed for Strong dominance)
    if (concentration && dominanceLevel !== "Strong") {
      if (concentration.level === "High") {
        lines.push(
          {severity: "MEDIUM", text: `A large share of your spending was concentrated in just two categories, which together made up ${concentration.combinedPercent}% of your total expenses.`}
        );
      } else if (concentration.level === "Moderate") {
        lines.push(
          {severity: "LOW", text: `Your top two categories together accounted for ${concentration.combinedPercent}% of your yearly spending.`}
        );
      }
    }
    
    return lines;
  },

};