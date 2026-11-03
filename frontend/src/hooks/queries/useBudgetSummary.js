import { format } from "date-fns";
import { useBudgetsQuery } from "./useBudgetsQuery";

// Derives the budget list, loading/error status, and the current month's total from the shared budgets query.
export const useBudgetSummary = () => {
  const budgetsQuery = useBudgetsQuery();

  const monthlyBudgets = budgetsQuery.data?.success ? (budgetsQuery.data.data ?? []) : [];

  const budgetStatus = budgetsQuery.isLoading
    ? "loading"
    : budgetsQuery.isError || budgetsQuery.data?.success === false
    ? "error"
    : "ready";

  // The server stores budgets under a fixed English "MMM YYYY" key ("Sep 2026").
  const currentMonth = format(new Date(), "MMM yyyy");

  const currentBudget = monthlyBudgets.find((b) => b.month === currentMonth);

  const totalBudget = currentBudget?.budget || 0;

  const staleMonths = budgetsQuery.data?.staleMonths ?? [];
  const recoveryPending = budgetsQuery.data?.recoveryPending === true;
  const isCurrentMonthStale = recoveryPending && staleMonths.includes(currentMonth);

  return {
    monthlyBudgets,
    budgetStatus,
    totalBudget,
    recoveryPending,
    isCurrentMonthStale,
    // FE-001-T08 -- lets any consumer offer a Retry action on budgetStatus === "error"
    // without reaching into the underlying TanStack Query object itself.
    refetchBudgets: budgetsQuery.refetch,
  };
};
