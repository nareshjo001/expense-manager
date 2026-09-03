import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { format } from "date-fns";
import SetBudget from "./SetBudget";

// Phase C.2 -- proves SetBudget threads useBudgetSummary's
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

// FE-001-T08 -- the loading/error branches previously had no ARIA role and
// the error branch had no way to recover short of a page reload.
describe("SetBudget -- FE-001-T08 loading/error state a11y and retry", () => {
  it("exposes the loading branch as an accessible status region", () => {
    mockSummary = {
      monthlyBudgets: [],
      budgetStatus: "loading",
      isCurrentMonthStale: false,
    };

    render(<SetBudget />);

    expect(screen.getByRole("status")).toHaveTextContent(/fetching budget/i);
  });

  it("exposes the error branch as an accessible alert and offers a working Retry", () => {
    const refetchBudgets = jest.fn();
    mockSummary = {
      monthlyBudgets: [],
      budgetStatus: "error",
      isCurrentMonthStale: false,
      refetchBudgets,
    };

    render(<SetBudget />);

    expect(screen.getByRole("alert")).toHaveTextContent(/network error/i);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetchBudgets).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the error branch renders without a refetchBudgets function", () => {
    mockSummary = {
      monthlyBudgets: [],
      budgetStatus: "error",
      isCurrentMonthStale: false,
    };

    render(<SetBudget />);

    expect(() => fireEvent.click(screen.getByRole("button", { name: "Retry" }))).not.toThrow();
  });
});
