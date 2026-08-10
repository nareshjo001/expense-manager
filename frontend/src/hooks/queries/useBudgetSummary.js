import { useBudgetsQuery } from "./useBudgetsQuery";

// Derives the budget list, loading/error status, and the current month's total from the shared budgets query.
//
// Phase C.2 -- GET /api/getbudgets additively returns `recoveryPending`
// (boolean) and `staleMonths` (month-key strings) whenever a prior
// mutation's budget recalculation is still catching up (see
// Controllers/BudgetControllers/getbudgets.js). Those fields previously had
// no frontend consumer at all -- this hook is the single funnel every
// budget-spend display goes through (SetBudget.js/BudgetBar.js), so it is
// where that signal is picked up and turned into `isCurrentMonthStale`:
// specifically whether the CURRENT month (the only one BudgetBar.js
// actually renders `.spent` for) is named in `staleMonths`. Chosen behavior
// (per the Phase C.2 brief): keep showing the existing stored values --
// never block the read -- paired with a calm, explicit "refreshing" signal,
// rather than a retriable error state. Optional-chained throughout so
// older/mocked response shapes without these fields default to "not
// stale", never throwing.
export const useBudgetSummary = () => {
  const budgetsQuery = useBudgetsQuery();

  const monthlyBudgets = budgetsQuery.data?.success ? (budgetsQuery.data.data ?? []) : [];

  const budgetStatus = budgetsQuery.isLoading
    ? "loading"
    : budgetsQuery.isError || budgetsQuery.data?.success === false
    ? "error"
    : "ready";

  const currentMonth =
    new Date().toLocaleString("default", { month: "short" }) +
    " " +
    new Date().getFullYear();

  const currentBudget = monthlyBudgets.find((b) => b.month === currentMonth);

  const totalBudget = currentBudget?.budget || 0;

  const staleMonths = budgetsQuery.data?.staleMonths ?? [];
  const recoveryPending = budgetsQuery.data?.recoveryPending === true;
  const isCurrentMonthStale = recoveryPending && staleMonths.includes(currentMonth);

  return { monthlyBudgets, budgetStatus, totalBudget, recoveryPending, isCurrentMonthStale };
};
