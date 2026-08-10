import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { format } from "date-fns";
import SetBudget from "./SetBudget";

// Phase C.2 -- proves SetBudget threads useBudgetSummary's
// `isCurrentMonthStale` signal through to BudgetBar so a user viewing their
// current month's budget while a mutation's derived-data recovery is still
// pending sees a calm "Budget is refreshing" note rather than silently
// treating a possibly-stale `.spent` value as an ordinary fresh one.
const CURRENT_MONTH = format(new Date(), "MMM yyyy");

let mockSummary;

jest.mock("../../../hooks/queries/useBudgetSummary", () => ({
  useBudgetSummary: () => mockSummary,
}));

jest.mock("../../../hooks/mutations/useCreateBudgetMutation", () => ({
  useCreateBudgetMutation: () => ({ mutate: jest.fn(), isPending: false }),
}));

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("SetBudget -- Phase C.2 stale-state UX", () => {
  it("does not show the refreshing note when the current month's budget is fresh", () => {
    mockSummary = {
      monthlyBudgets: [{ month: CURRENT_MONTH, budget: 5000, spent: 1200 }],
      budgetStatus: "ready",
      isCurrentMonthStale: false,
    };

    render(<SetBudget />);

    expect(screen.queryByText(/budget is refreshing/i)).not.toBeInTheDocument();
  });

  it("shows a calm refreshing note (not an error state) when the current month is flagged stale", () => {
    mockSummary = {
      monthlyBudgets: [{ month: CURRENT_MONTH, budget: 5000, spent: 1200 }],
      budgetStatus: "ready",
      isCurrentMonthStale: true,
    };

    render(<SetBudget />);

    expect(screen.getByText(/budget is refreshing/i)).toBeInTheDocument();
    // The existing values are still displayed alongside the note.
    expect(screen.getByText("24%")).toBeInTheDocument();
    // Never surfaced as the page's error state.
    expect(screen.queryByText(/network error/i)).not.toBeInTheDocument();
  });

  it("does not render the refreshing note (or BudgetBar at all) while the query is loading", () => {
    mockSummary = {
      monthlyBudgets: [],
      budgetStatus: "loading",
      isCurrentMonthStale: false,
    };

    render(<SetBudget />);

    expect(screen.queryByText(/budget is refreshing/i)).not.toBeInTheDocument();
    expect(screen.getByText(/fetching budget/i)).toBeInTheDocument();
  });
});
