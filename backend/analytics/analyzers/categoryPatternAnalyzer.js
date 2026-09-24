const { groupByCategoryHelper } = require("../../Services/HelperServices/getexpense.service");

// DAT-001-T03 -- shared with every other money-rounding call site via
// backend/utils/money.js, instead of an independently redefined helper.
const { roundMoney: round2 } = require("../../utils/money");

// ANL-001-T03 -- CategoryPatternSignal, per the ANL-001-T02 contract.
//
// This is a deliberate, documented backend-native REINTERPRETATION of the
// legacy frontend rule (frontend/src/insights-engine/rules/categoryPatterns.js),
// not a byte-for-byte port. The original frontend algorithm keys its
// Habit/Spike classification off a 3-month rolling category history that
// this backend analytics pipeline does not have readily available at this
// call site (only the current month's categoryAnalyzer report -- which is
// itself only a single-period-over-previous-period comparison -- and the
// yearly categoryAnalyzer report are in scope for T03). The rules below
// are therefore a fresh, contract-conformant definition built entirely
// from what monthlyCategoryReport/yearlyCategoryReport/currentMonthExpenses
// already expose, not an attempt to reproduce the old frontend math.
// This is intentional per the ANL-001-T02 contract, not a bug.

const toSafeNumber = (value, fallback = 0) => {
  // Number() throws (rather than returning NaN) for an object with no
  // usable valueOf/toString -- e.g. Object.create(null) -- so this can't
  // rely on Number.isFinite alone to catch every malformed shape.
  if (typeof value !== "number" && typeof value !== "string") return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

// Rounds a plain 0-1 ratio (yearlyStability, yearlyConcentration) to 4
// decimal places. Deliberately NOT roundMoney/round2 -- those round to
// rupee-paise (2 decimal) precision, which is the wrong granularity for a
// unitless 0-1 signal the contract specifies to 4 decimals.
const round4 = (value) => Math.round(value * 10000) / 10000;

// Classifies the monthly report's dominant category as a steady "Habit" or
// a one-off "Spike": a >=50% month-over-month jump landing on the very
// category that is currently dominant reads as a spike; a dominant
// category with no such outsized jump reads as a recurring habit.
const classifyDominantCategory = (monthlyCategoryReport = {}, dominantCategory = null) => {
  if (!dominantCategory) return null;

  const { biggestJump = null } = monthlyCategoryReport || {};
  const isSpike =
    biggestJump !== null &&
    biggestJump.category === dominantCategory &&
    typeof biggestJump.growthPercentage === "number" &&
    biggestJump.growthPercentage >= 50;

  return isSpike ? "Spike" : "Habit";
};

// Groups the current month's expenses by category and flags categories
// whose transactions skew heavily toward many small ("micro") purchases --
// a transaction counts as micro when it's under 10% of its own category's
// average transaction amount. Categories with fewer than 2 transactions
// are skipped entirely (no meaningful average to compare against), and a
// category is only reported when it has 3+ micro transactions.
const detectMicroTransactions = (currentMonthExpenses = []) => {
  // Malformed entries (null/undefined/non-object) can reach this analyzer
  // directly -- unlike categoryAnalyzer's own totals, which only ever see
  // currentMonthExpenses through this same helper, this is a second,
  // independent call site, so it needs its own guard rather than assuming
  // upstream already filtered. groupByCategoryHelper itself reads
  // exp.expenseCategory unconditionally and is shared with other call
  // sites, so the filter belongs here rather than in that shared helper.
  const safeExpenses = (Array.isArray(currentMonthExpenses) ? currentMonthExpenses : []).filter(
    (expense) => expense !== null && typeof expense === "object"
  );
  const grouped = groupByCategoryHelper(safeExpenses);

  return Object.entries(grouped).reduce((result, [category, expenses]) => {
    const list = Array.isArray(expenses) ? expenses : [];
    if (list.length < 2) return result;

    const amounts = list.map((expense) => toSafeNumber(expense?.expenseAmount));
    const total = amounts.reduce((sum, amount) => sum + amount, 0);
    const average = total / amounts.length;
    const microThreshold = average * 0.1;

    const microAmounts = amounts.filter((amount) => amount < microThreshold);
    if (microAmounts.length < 3) return result;

    result.push({
      category,
      count: microAmounts.length,
      totalAmount: round2(microAmounts.reduce((sum, amount) => sum + amount, 0)),
    });
    return result;
  }, []);
};

// Measures how stable the category mix has been year over year: the mean
// absolute growth percentage across existing (non-new) categories, folded
// into a 0-1 score where higher means more stable (less average swing).
const calculateYearlyStability = (yearlyCategoryReport = {}) => {
  if (!yearlyCategoryReport?.hasData) return null;

  const categoryGrowth = Array.isArray(yearlyCategoryReport.categoryGrowth)
    ? yearlyCategoryReport.categoryGrowth
    : [];
  if (!categoryGrowth.length) return null;

  const comparable = categoryGrowth.filter(
    (entry) => entry.isNewCategory === false && entry.growthPercentage !== null
  );
  if (!comparable.length) return null;

  const meanAbsGrowthPercent =
    comparable.reduce((sum, entry) => sum + Math.abs(entry.growthPercentage), 0) / comparable.length;

  const stability = Math.max(0, Math.min(1, 1 - meanAbsGrowthPercent / 100));
  return round4(stability);
};

// Assembles the CategoryPatternSignal from the monthly/yearly categoryAnalyzer
// reports and the current month's raw expenses.
const analyze = ({ monthlyCategoryReport = {}, yearlyCategoryReport = {}, currentMonthExpenses = [] } = {}) => {
  if (!monthlyCategoryReport?.hasData) {
    return {
      hasData: false,
      reasonCode: "NO_MONTHLY_CATEGORY_DATA",
      dominantCategory: null,
      classification: null,
      microTransactionCategories: [],
      yearlyStability: null,
      yearlyConcentration: null,
    };
  }

  const dominantCategory = monthlyCategoryReport.topCategory?.category ?? null;

  return {
    hasData: true,
    reasonCode: null,
    dominantCategory,
    classification: classifyDominantCategory(monthlyCategoryReport, dominantCategory),
    microTransactionCategories: detectMicroTransactions(currentMonthExpenses),
    yearlyStability: calculateYearlyStability(yearlyCategoryReport),
    yearlyConcentration: yearlyCategoryReport?.hasData
      ? round4(yearlyCategoryReport.top3Concentration / 100)
      : null,
  };
};

module.exports = { classifyDominantCategory, detectMicroTransactions, calculateYearlyStability, analyze };
