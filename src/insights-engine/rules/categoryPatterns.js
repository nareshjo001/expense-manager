import { calculateMedian } from "../statistics/statsCalculation";

const findTopAndDominantCategory = (
  categoryTotals = [],
  filterMeta = '',
  dominanceThreshold = 35,
) => {
  if (!Array.isArray(categoryTotals) || categoryTotals.length === 0) {
    return null;
  }

  const overallTotal = categoryTotals.reduce(
    (sum, cat) => sum + Number(cat.total || 0),
    0
  );

  if (overallTotal === 0) return null;

  const withPercent = categoryTotals.map(({ category, total }) => ({
    category,
    total: Number(total || 0),
    percent: (Number(total || 0) / overallTotal) * 100,
  }));
  
  // Highest spending category (always exists)
  const topCategory = withPercent.reduce((max, curr) =>
    curr.percent > max.percent ? curr : max
  );

  if(filterMeta === 'thismonth') {
    // Dominant only if threshold crossed
    const dominantCategory =
      topCategory.percent >= dominanceThreshold ? topCategory : null;

    return {
      top: topCategory,           // always
      dominant: dominantCategory, // nullable
    };
  } else {
    // Dominance Level
    let dominanceLevel = '';
    if(topCategory.percent >= 40) dominanceLevel = 'Strong';
    else if(topCategory.percent >= 25 && topCategory.percent < 40) dominanceLevel = 'Moderate';
    else dominanceLevel = 'Balanced';

    return {
      top: topCategory,
      dominanceLevel
    }
  }
  
};

const habitOrSpike = (dominant, pastThreeMonths) => {
    if (!dominant || !pastThreeMonths || pastThreeMonths.length < 3) return null;

    const pastTotals = pastThreeMonths.map(({ categories }) => {
        const group = categories[dominant.category] || [];
        return Array.isArray(group)
        ? group.reduce((sum, e) => sum + Number(e.expenseAmount || 0), 0)
        : 0;
    });

    const currentTotal = dominant.total;

    // Step 1: mean and std
    const mean = pastTotals.reduce((sum, x) => sum + x, 0) / pastTotals.length;
    const variance = pastTotals.reduce((sum, x) => sum + (x - mean) ** 2, 0) / pastTotals.length;
    const std = Math.sqrt(variance);

    // Step 2: thresholds based on volatility
    const CONSISTENT_LOWER = mean - std;
    const CONSISTENT_UPPER = mean + std;
    const MODERATE_SPIKE_UPPER = mean + 2 * std;

    let isConsistent = false;
    let isModerateSpike = false;
    let isStrongSpike = false;

    if (currentTotal < 1000) {
      return {
        isConsistent: false,
        isModerateSpike: false,
        isStrongSpike: false,
      };
    }

    if (currentTotal >= CONSISTENT_LOWER && currentTotal <= CONSISTENT_UPPER) {
        isConsistent = true;
    } else if (currentTotal > CONSISTENT_UPPER && currentTotal <= MODERATE_SPIKE_UPPER) {
        isModerateSpike = true;
    } else if (currentTotal > MODERATE_SPIKE_UPPER) {
        isStrongSpike = true;
    }

    return { isConsistent, isModerateSpike, isStrongSpike };
};

const detectMicroTransactions = (expensesByCategory = {}) => {
  // Find category with the most transactions
  const categoryWithMostTransactions = Object.entries(expensesByCategory)
    .reduce(
      (maxCat, [cat, expenses]) => {
        const count = Array.isArray(expenses) ? expenses.length : 0;
        return count > maxCat.count ? { cat, count } : maxCat;
      },
      { cat: null, count: 0 }
    ).cat;

  if (!categoryWithMostTransactions) {
    return { hasMicroTransactions: false, meta: {} };
  }

  const categoryExpenses = expensesByCategory[categoryWithMostTransactions];

  // Extract positive expense amounts
  const amounts = categoryExpenses
    .map(exp => Number(exp.expenseAmount || 0))
    .filter(val => val > 0);

  const n = amounts.length;

  // Guard: not enough data
  if (n < 6) {
    return { hasMicroTransactions: false, meta: { transactionCount: n } };
  }

  // Compute mean and median
  const total = amounts.reduce((sum, x) => sum + x, 0);
  const mean = total / n;

  const median = calculateMedian(amounts);

  // Define "small transaction"
  const SMALL_FACTOR = 0.6; // 60% of mean
  const smallThreshold = mean * SMALL_FACTOR;

  const smallCount = amounts.filter(a => a <= smallThreshold).length;
  const smallRatio = smallCount / n;

  const hasMicroTransactions = smallRatio >= 0.5;

  return {
    hasMicroTransactions,
    category: categoryWithMostTransactions,
    meta: {
      transactionCount: n,
      smallRatio,
      mean,
      median,
      smallThreshold,
      smallCount,
    },
  };
};

const yearlyCategoryStablity = (expenses, top) => {
  
  if (!expenses || !top?.category) return null;

  const flattenExpenses = (expenses = {}) =>
    Object.entries(expenses).flatMap(([category, list]) =>
      (list || []).map(exp => ({
        ...exp,
      }))
  );

  const groupMonthAndCategory = (expenses = {}) => {
    const flat = flattenExpenses(expenses);

    return flat.reduce((acc, exp) => {
      const date = new Date(exp.expenseDate);
      const monthKey = `${date.getFullYear()}-${String(
        date.getMonth() + 1
      ).padStart(2, "0")}`;

      if (!acc[monthKey]) acc[monthKey] = {};
      if (!acc[monthKey][exp.expenseCategory]) acc[monthKey][exp.expenseCategory] = [];

      acc[monthKey][exp.expenseCategory].push(exp);

      return acc;
    }, {});
  };

  const grouped = groupMonthAndCategory(expenses);
  const topCategory = top.category;

  let stableMonths = 0;
  let totalMonthsWithSpend = 0;

  const sumExpenses = (list = []) =>
      list.reduce((sum, e) => sum + Number(e.expenseAmount || 0), 0);

  Object.values(grouped).forEach(monthCategories => {
    // Tj = total spend of month
    const Tj = Object.values(monthCategories)
      .flat()
      .reduce((sum, e) => sum + Number(e.expenseAmount || 0), 0);

    if (Tj === 0) return; // skip empty month

    totalMonthsWithSpend++;

    // Cj = top category spend in that month
    const Cj = sumExpenses(monthCategories[topCategory] || []);

    // Pj = share %
    const Pj = (Cj / Tj) * 100;

    // Relevant month
    if (Pj >= 20) {
      stableMonths++;
    }
  });

  if (stableMonths < 4) return {
    isStable: false,
  };

  let stabilityLevel = "LOW";
  if (stableMonths >= 8) stabilityLevel = "HIGH";
  else if (stableMonths >= 4) stabilityLevel = "MEDIUM";

  return {
    isStable: true,
    stabilityLevel,
    stableMonths,
    totalMonthsWithSpend,
  };
}

const yearlyCategoryConcentration = (categoryTotals) => {
  if (!Array.isArray(categoryTotals) || categoryTotals.length === 0) {
    return null;
  }

  const overallTotal = categoryTotals.reduce(
    (sum, cat) => sum + Number(cat.total || 0),
    0
  );

  if (overallTotal === 0) return null;

  const withPercent = categoryTotals.map(({ category, total }) => ({
    category,
    total,
    percent: (total / overallTotal) * 100,
  })).sort((a, b) => b.percent - a.percent);

  if (withPercent.length < 3) return null;

  const [first, second] = withPercent;
  const topTwo = [first, second].filter(Boolean);

  const topTwoSummary = {
    total: topTwo.reduce((s, i) => s + i.total, 0),
    percent: topTwo.reduce((s, i) => s + i.percent, 0),
  };

  const roundedPercent = Number(topTwoSummary.percent.toFixed(1));

  let concentration = '';

  if (roundedPercent >= 67) concentration = 'High';
  else if (roundedPercent >= 52) concentration = 'Moderate';
  else concentration = 'Distributed';

  if(concentration !== 'Distributed'){ 
    return {
      isHeavyConcentration: true,
      concentrationLevel: concentration,
      topTwo,
      topTwoSummary,
    }
  }
}

export const categorySpend = ({ 
    expenses = {},
    pastThreeMonths = [],
    filterMeta = "",
    scope,
    }) => { 
        if (!expenses || Object.keys(expenses).length === 0) {
            return null;
        }

        const categoryTotals = Object.entries(expenses).map(
            ([category, groupList]) => ({
            category,
            total: Array.isArray(groupList)
                ? groupList.reduce(
                    (sum, exp) => sum + Number(exp.expenseAmount || 0),
                    0
                )
                : 0,
            })
        );
        
        const result = findTopAndDominantCategory(categoryTotals, filterMeta);
        if (!result) return null;
        
        if(filterMeta === 'thismonth') {
          const { top, dominant } = result;
            // Case 1: Dominant category exists
            if (dominant) {
                const { isConsistent, isModerateSpike, isStrongSpike } = habitOrSpike(dominant, pastThreeMonths);
                const microResult = detectMicroTransactions(expenses);

                return {
                    type: "THIS_MONTH_CATEGORY_SUMMARY",
                    payload: {
                    hasDominantCategory: true,
                    hasMicroTransactions: microResult.hasMicroTransactions,
                    microCategory: microResult.category,
                    category: dominant.category,
                    percent: Number(dominant.percent.toFixed(1)),
                    total: dominant.total,
                    isConsistent,
                    isModerateSpike,
                    isStrongSpike,
                    },
                };
            }

            // Case 2: No dominance → fallback to top category
            return {
                type: "THIS_MONTH_CATEGORY_SUMMARY",
                payload: {
                hasDominantCategory: false,
                topCategory: top.category,
                topPercent: Number(top.percent.toFixed(1)),
                topTotal: top.total,
                },
            };
        } else if(filterMeta === 'thisyear') {
            const { top, dominanceLevel } = result;
            
            const stablity = yearlyCategoryStablity(expenses, top);

            const heavyConcentration = yearlyCategoryConcentration(categoryTotals);

            return {
              type: "THIS_YEAR_CATEGORY_SUMMARY",
              payload: {
                // --- Insight #1: Dominance (always present)
                topCategory: top.category,
                topPercent: Number(top.percent.toFixed(1)),
                dominanceLevel, // "Strong" | "Moderate" | "Balanced"

                // --- Insight #2: Stability (optional)
                stability: stablity
                  ? {
                      isStable: true,
                      level: stablity.stabilityLevel, // HIGH | MEDIUM
                      stableMonths: stablity.stableMonths,
                    }
                  : null,

                // --- Insight #3: Concentration (optional)
                concentration: heavyConcentration
                  ? {
                      level: heavyConcentration.concentrationLevel, // High | Moderate
                      combinedPercent: Number(
                        heavyConcentration.topTwoSummary.percent.toFixed(1)
                      ),
                    }
                  : null,
              },
            };
        }
};