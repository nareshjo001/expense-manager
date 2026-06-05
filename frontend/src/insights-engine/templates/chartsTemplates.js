export const chartInsightTemplates = {
  LINE_CHART_SUMMARY: ({
    isEnoughData,
    ending,
    isVolatile,
    direction,
    text = '',
  }) => {
    if (!isEnoughData) {
      return {
        text,
        severity: "LOW",
        trend: "FLAT",
      };
    }

    // 🔺 Recent momentum first
    if (ending === "rising") {
      if (isVolatile) {
        return {
          text: "Spending has been trending upward recently, with noticeable fluctuations along the way.",
          severity: "HIGH",
          trend: "UP",
        };
      }
      return {
        text: "Spending has shown a steady upward pattern in recent periods.",
        severity: "MEDIUM",
        trend: "UP",
      };
    }

    if (ending === "falling") {
      if (isVolatile) {
        return {
          text: "Spending has been trending downward recently, with noticeable fluctuations along the way.",
          severity: "MEDIUM",
          trend: "DOWN",
        };
      }
      return {
        text: "Spending has shown a steady downward pattern in recent periods.",
        severity: "LOW",
        trend: "DOWN",
      };
    }

    // ➖ Stable ending → look at overall direction
    if (direction === "up") {
      if (isVolatile) {
        return {
          text: "Spending followed an overall upward pattern, with noticeable fluctuations during the period.",
          severity: "MEDIUM",
          trend: "UP",
        };
      }
      return {
        text: "Spending showed a gradual upward pattern over this period.",
        severity: "MEDIUM",
        trend: "UP",
      };
    }

    if (direction === "down") {
      if (isVolatile) {
        return {
          text: "Spending decreased overall and became more stable toward the end of the period.",
          severity: "LOW",
          trend: "DOWN",
        };
      }
      return {
        text: "Spending showed a gradual downward pattern over this period.",
        severity: "LOW",
        trend: "DOWN",
      };
    }

    // ➖ Flat direction
    if (isVolatile) {
      return {
        text: "Spending fluctuated noticeably during this period.",
        severity: "MEDIUM",
        trend: "FLAT",
      };
    }

    return {
      text: "Spending remained relatively stable throughout this period.",
      severity: "LOW",
      trend: "FLAT",
    };
  },

   BAR_CHART_SUMMARY: ({
    filter,
    isEnoughData,
    budgetOverrun,
    budgetPressure,
    highSpendConcentration,
    moderateSpendConcentration,
    category,
    topSharePercent,
    text = ''
  }) => {
        if (!isEnoughData) {
        return {
            text,
            severity: "LOW",
        };
        }

        if(filter === 'bymonth') {
            if (budgetOverrun) {
                return {
                    severity: "HIGH",
                    text: "Spending went beyond the planned budget in some months."
                };
            }

            if (budgetPressure) {
                return {
                    severity: "MEDIUM",
                    text: "Spending stayed close to the budget limit during this period."
                };
            }

            return {
                severity: "LOW",
                text: "Spending remained within budget across the selected months."
            };

        } else if(filter === 'bycategory') {
            if (highSpendConcentration) {
                return {
                    severity: "HIGH",
                    text: `A large share of spending was concentrated in ${category}, accounting for ${topSharePercent}% of the total.`
                };
            }

            if (moderateSpendConcentration) {
                return {
                    severity: "MEDIUM",
                    text: `${category} was the largest spending category during this period at ${topSharePercent}% of total spending.`
                };
            }

            return {
                severity: "LOW",
                text: "Spending was fairly balanced across categories during this period."
            }
        }   
    },

    PIE_CHART_SUMMARY: ({
      filter,
      ratio,
      category,
      highConcentration,
      moderateConcentration,
      isEnoughData,
      topSharePercent,
      text = "",
    }) => {
      if (!isEnoughData) {
        return { severity: "LOW", text };
      }

      // ---- Budget vs Spent ----
      if (filter === "comparison") {
        if (ratio >= 1) {
          return { severity: "HIGH", text: "You exceeded your budget this month." };
        }
        if (ratio >= 0.85) {
          return { severity: "MEDIUM", text: "Spending stayed close to your budget limit this month." };
        }
        return { severity: "LOW", text: "You stayed within your budget this month." };
      }

      if (filter === 'distribution') {
        if (highConcentration) {
          return {
            severity: "HIGH",
            text: `A large share of spending was concentrated in ${category}, accounting for ${topSharePercent}% of total spending.`
            };
          }

        if (moderateConcentration) {
          return {
            severity: "MEDIUM",
            text: `${category} was the largest spending category during this period at ${topSharePercent}% of total spending.`
          };
        }

        return {
          severity: "LOW",
          text: "Spending was fairly balanced across categories during this period."
        }
      }

      if (filter === 'count') {
        if (highConcentration) {
          return {
            severity: "HIGH",
            text: `A large portion of your transactions came from ${category}, accounting for ${topSharePercent}% of all transactions.`
            };
          }

        if (moderateConcentration) {
          return {
            severity: "MEDIUM",
            text: `${category} had the highest number of transactions during this period.`
          };
        }

        return {
          severity: "LOW",
          text: "Your transactions were fairly balanced across categories during this period."
        }
      }
    },
};