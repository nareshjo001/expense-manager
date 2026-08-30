import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import Header from "./Header";

jest.mock("../../hooks/queries/useBudgetSummary", () => ({
  useBudgetSummary: () => ({ totalBudget: 5000, monthlyBudgets: [], budgetStatus: "ready" }),
}));

jest.mock("../../hooks/mutations/useUpdateBudgetMutation", () => ({
  useUpdateBudgetMutation: () => ({ mutate: jest.fn(), isPending: false }),
}));

afterEach(() => {
  cleanup();
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
