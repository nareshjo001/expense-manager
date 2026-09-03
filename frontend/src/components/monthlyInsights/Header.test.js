import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import Header from "./Header";

jest.mock("../../hooks/queries/useBudgetSummary", () => ({
  useBudgetSummary: jest.fn(),
}));

jest.mock("../../hooks/mutations/useUpdateBudgetMutation", () => ({
  useUpdateBudgetMutation: () => ({ mutate: jest.fn(), isPending: false }),
}));

const { useBudgetSummary } = require("../../hooks/queries/useBudgetSummary");

beforeEach(() => {
  useBudgetSummary.mockReturnValue({
    totalBudget: 5000,
    monthlyBudgets: [],
    budgetStatus: "ready",
    refetchBudgets: jest.fn(),
  });
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("monthlyInsights/Header -- compact budget summary", () => {
  it("does not render the removed Spending Trend Ask SIA action", () => {
    render(<Header summary={{ comparePastMonth: 12, totalSpent: 1200, dailyAverage: 40, transactionCount: 5, topCategory: "Food" }} />);

    expect(screen.queryByRole("button", { name: "Ask SIA about this trend" })).not.toBeInTheDocument();
  });

  it("still renders all four summary containers", () => {
    render(<Header summary={{ comparePastMonth: 12, totalSpent: 1200, dailyAverage: 40, transactionCount: 5, topCategory: "Food" }} />);

    expect(screen.getByText("Spending Trend")).toBeInTheDocument();
    expect(screen.getByText("Daily Average")).toBeInTheDocument();
    expect(screen.getByText("Payment Count")).toBeInTheDocument();
    expect(screen.getByText("Top Category")).toBeInTheDocument();
  });

  it("does not alter the existing Spending Trend text/calculations", () => {
    render(<Header summary={{ comparePastMonth: 15, totalSpent: 900 }} />);

    expect(screen.getByText(/15% higher than last month/i)).toBeInTheDocument();
  });

  it("opens the budget editor from the header edit button", () => {
    render(<Header summary={{ comparePastMonth: 12, totalSpent: 1200 }} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit budget" }));

    expect(screen.getByRole("heading", { name: "Edit Budget" })).toBeInTheDocument();
  });
});

// FE-001-T08 -- this header's OWN useBudgetSummary subscription (separate
// from SetBudget.js's) previously ignored isLoading/isError entirely and
// rendered totalBudget (defaulting to 0) regardless of query state.
describe("monthlyInsights/Header -- FE-001-T08 budget-total state matrix", () => {
  it("shows an accessible loading state for the budget total and disables editing while it loads", () => {
    useBudgetSummary.mockReturnValue({
      totalBudget: 0,
      monthlyBudgets: [],
      budgetStatus: "loading",
      refetchBudgets: jest.fn(),
    });

    render(<Header summary={{ comparePastMonth: 12, totalSpent: 1200 }} />);

    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
    expect(screen.queryByText("Total Budget")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit budget" })).toBeDisabled();
  });

  it("shows an accessible error state for the budget total with a working Retry, and disables editing", () => {
    const refetchBudgets = jest.fn();
    useBudgetSummary.mockReturnValue({
      totalBudget: 0,
      monthlyBudgets: [],
      budgetStatus: "error",
      refetchBudgets,
    });

    render(<Header summary={{ comparePastMonth: 12, totalSpent: 1200 }} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/unable to load/i);
    expect(screen.getByRole("button", { name: "Edit budget" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetchBudgets).toHaveBeenCalledTimes(1);
  });

  it("still renders the real total budget and an enabled edit button once ready (unchanged behavior)", () => {
    render(<Header summary={{ comparePastMonth: 12, totalSpent: 1200 }} />);

    expect(screen.getByText("Total Budget")).toBeInTheDocument();
    expect(screen.getByText("₹ 5000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit budget" })).not.toBeDisabled();
  });
});
