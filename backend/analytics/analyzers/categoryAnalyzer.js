const { groupByCategoryHelper } = require("../../Services/HelperServices/getexpense.service");

const toSafeNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const round2 = (value) => Number(Number(value).toFixed(2));

// Calculates the total amount spent in each category
const getCategoryTotals = (groupedExpenses = {}) => {
  if (!groupedExpenses || typeof groupedExpenses !== "object") return [];
 
  return Object.entries(groupedExpenses).map(([category, expenses]) => {
    const list = Array.isArray(expenses) ? expenses : [];
    const total = list.reduce(
      (sum, expense) => sum + toSafeNumber(expense?.expenseAmount ?? expense?.amount),
      0
    );
 
    return { category, total: round2(total) };
  });
};

// Calculates the category with the highest and lowest total spending, as well as the distribution of spending across categories
const calculateTopCategory = (totals = []) => {
    if (!totals.length) return null;

    return totals.reduce((max, current) =>
        current.total > max.total ? current : max
    );
}; 

// Calculates the category with the lowest total spending
const calculateLeastCategory = (totals = []) => {
    if (!totals.length) return null;
 
    return totals.reduce((min, current) =>
        current.total < min.total ? current : min
    );
};

// Calculates the distribution of spending across categories, returning an array of objects with category, amount, and percentage
const calculateCategoryDistribution = (totals = []) => {
  const positiveTotal = totals.reduce((sum, item) => sum + Math.max(0, item.total), 0);
 
  return [...totals]
    .sort((a, b) => b.total - a.total)
    .map((item) => ({
      category: item.category,
      amount: item.total,
      percentage: positiveTotal === 0 ? 0 : round2((Math.max(0, item.total) / positiveTotal) * 100),
    }));
};

/**
 * Herfindahl-Hirschman-style concentration index across ALL categories
 * (0-100 scale, higher = more concentrated). Catches the case where no
 * single category is extreme, but the top few together dominate spend —
 * something top-1 percentage alone can miss entirely.
 */
const calculateConcentrationIndex = (distribution = []) => {
  if (!distribution.length) return null;
  
  const sumOfSquares = distribution.reduce((sum, item) => sum + Math.pow(item.percentage, 2), 0);
  
  return round2(sumOfSquares / 100);
};

// Calculates the total percentage of spending in the top N categories
const calculateTopNConcentration = (distribution = [], n = 3) => {
  if (!distribution.length) return null;
  
  return round2(distribution.slice(0, n).reduce((sum, item) => sum + item.percentage, 0));
};

// Calculates the growth in spending for each category compared to the previous period
const calculateCategoryGrowth = (currentTotals = [], previousTotals = []) => {
  
  const currentMap = Object.fromEntries(currentTotals.map((item) => [item.category, item.total]));
  const previousMap = Object.fromEntries(previousTotals.map((item) => [item.category, item.total]));
 
  const categories = new Set([...Object.keys(currentMap), ...Object.keys(previousMap)]);
 
  return [...categories].map((category) => {
    const current = toSafeNumber(currentMap[category]);
    const previous = toSafeNumber(previousMap[category]);
    const change = round2(current - previous);
 
    let growthPercentage = null;
    let isNewCategory = false;
 
    if (previous > 0) {
      growthPercentage = round2((change / previous) * 100);
    } else if (previous === 0 && current > 0) {
      isNewCategory = true;
    }
 
    return {
      category,
      previous,
      current,
      change,
      growthPercentage,
      isNewCategory,
      trend: change > 0 ? "up" : change < 0 ? "down" : "same",
    };
  });
};

// Calculates the biggest increase and decrease in spending among categories
const calculateBiggestChanges = (categoryGrowth = []) => {
    // Categories with positive percentage growth
    const increases = categoryGrowth.filter(
        c => c.growthPercentage !== null && c.growthPercentage > 0
    );

    // Categories with negative change
    const decreases = categoryGrowth.filter(c => c.change < 0);

    return {
        // Highest percentage increase
        biggestJump: increases.length
            ? increases.reduce((a, b) =>
                a.growthPercentage > b.growthPercentage ? a : b
            )
            : null,

        // Largest absolute decrease
        biggestDrop: decreases.length
            ? decreases.reduce((a, b) =>
                a.change < b.change ? a : b
            )
            : null,
    };
};

// Analyzes the current and previous expenses to generate a category report, including top and least categories, distribution, growth, and biggest changes
const analyze = (currentExpenses = {}, previousExpenses = {}) => {
  const currentTotals = getCategoryTotals(groupByCategoryHelper(currentExpenses));
  const previousTotals = getCategoryTotals(groupByCategoryHelper(previousExpenses));
 
  if (!currentTotals.length) {
    return { hasData: false };
  }
 
  const categoryDistribution = calculateCategoryDistribution(currentTotals);
  const categoryGrowth = calculateCategoryGrowth(currentTotals, previousTotals);
 
  return {
    hasData: true,
    topCategory: calculateTopCategory(currentTotals),
    leastCategory: calculateLeastCategory(currentTotals),
    categoryDistribution,
    concentrationIndex: calculateConcentrationIndex(categoryDistribution),
    top3Concentration: calculateTopNConcentration(categoryDistribution, 3),
    categoryGrowth,
    ...calculateBiggestChanges(categoryGrowth),
  };
};

module.exports = {
    calculateTopCategory,
    calculateLeastCategory,
    calculateCategoryDistribution,
    calculateConcentrationIndex,
    calculateTopNConcentration,
    calculateCategoryGrowth,
    calculateBiggestChanges,
    analyze
};