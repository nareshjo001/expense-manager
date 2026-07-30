// Detects a single dominant expense, a dominant pair, or a repeated-merchant cluster, using contribution-to-total and dominance-over-baseline heuristics.
export const detectExpenseAnomaly = (expenses = [], totalSpent = 0) => {
  if (expenses.length < 5 || totalSpent <= 0) return null;

  const values = expenses
    .map(e => Number(e.expenseAmount || 0))
    .filter(v => v > 0)
    .sort((a, b) => a - b);

  if (values.length < 5) return null;

  const sortedDesc = [...expenses].sort(
    (a, b) => Number(b.expenseAmount) - Number(a.expenseAmount)
  );

  const top1 = Number(sortedDesc[0].expenseAmount);
  const top2 = Number(sortedDesc[1]?.expenseAmount || 0);
  const top3 = Number(sortedDesc[2]?.expenseAmount || 0);

  // Uses the median of the lower half as a baseline resistant to the very outliers being detected.
  const lowerHalf = values.slice(0, Math.floor(values.length / 2));
  const baseline =
    lowerHalf.length % 2
      ? lowerHalf[Math.floor(lowerHalf.length / 2)]
      : (lowerHalf[lowerHalf.length / 2 - 1] +
         lowerHalf[lowerHalf.length / 2]) / 2;

  const contribution1 = top1 / totalSpent;
  const contribution2 = (top1 + top2) / totalSpent;
  const contribution3 = (top1 + top2 + top3) / totalSpent;

  const dominatesBaseline1 = top1 >= 3 * baseline;
  const dominatesBaseline2 = top2 >= 2 * baseline;
  const dominatesBaseline3 = top3 >= 2 * baseline;

  // A merchant name appearing 3+ times is treated as a clustered-spending signal.
  const merchantCounts = {};
  expenses.forEach(e => {
    const key =
      String(e.expenseName || "")
        .trim()
        .toLowerCase();

    if (!key) return;

    merchantCounts[key] =
      (merchantCounts[key] || 0) + 1;
  });

  const repeatedMerchant = Object.values(merchantCounts).some(
    count => count >= 3
  );

  let type = null;

  if (contribution1 >= 0.4 && dominatesBaseline1) {
    type = "single";
  } else if (contribution2 >= 0.5 && dominatesBaseline2) {
    type = "double";
  } else if (
    (contribution3 >= 0.5 || repeatedMerchant) &&
    dominatesBaseline3
  ) {
    type = "cluster";
  }

  if (!type) return null;

  return {
    type,
    dominantExpenses: sortedDesc
      .slice(0, type === "single" ? 1 : type === "double" ? 2 : 3)
      .map(e => ({
        name: e.expenseName,
        amount: e.expenseAmount,
      })),
    contributionRatio:
      type === "single"
        ? contribution1
        : type === "double"
        ? contribution2
        : contribution3,
    baseline,
    counts: {
      totalExpenses: expenses.length,
      dominantCount: type === "single" ? 1 : type === "double" ? 2 : 3,
    },
  };
};