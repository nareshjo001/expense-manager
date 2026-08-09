import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import Header from "./Header";

// Batch 3G placement test: proves the Spending Trend card renders exactly
// one shared SiaAskButton, wired to the exact centrally-registered
// suggestionId/label pair the spec requires -- not a re-test of the
// button/launcher's own behavior (see SiaAskButton.test.js and
// SiaLauncherContext.test.js for that).
jest.mock("../sia/SiaAskButton", () => {
  return function MockSiaAskButton(props) {
    return (
      <div
        data-testid="mock-sia-ask-button"
        data-suggestion-id={props.suggestionId}
        data-label={props.label}
        data-tone={props.tone ?? ""}
      />
    );
  };
});

jest.mock("../../hooks/queries/useBudgetSummary", () => ({
  useBudgetSummary: () => ({ totalBudget: 5000, monthlyBudgets: [], budgetStatus: "ready" }),
}));

jest.mock("../../hooks/mutations/useUpdateBudgetMutation", () => ({
  useUpdateBudgetMutation: () => ({ mutate: jest.fn(), isPending: false }),
}));

afterEach(() => {
  cleanup();
});

describe("monthlyInsights/Header -- Spending Trend contextual SIA button (Batch 3G)", () => {
  it("renders exactly one SiaAskButton wired to the spending-change suggestion", () => {
    render(<Header summary={{ comparePastMonth: 12, totalSpent: 1200, dailyAverage: 40, transactionCount: 5, topCategory: "Food" }} />);

    const buttons = screen.getAllByTestId("mock-sia-ask-button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute("data-suggestion-id", "spending-change");
    expect(buttons[0]).toHaveAttribute("data-label", "Ask SIA about this trend");
  });

  // Batch 3G remediation: this card's ancestor (.monthly-insights) already
  // sets an explicit `color: white` that is legible in both themes against
  // its saturated gradient background, so this placement must keep the
  // button's DEFAULT (inherited) appearance rather than opting into the
  // fixed "light-surface" tone added for BudgetIntelligence.js.
  it("keeps the default (non-light-surface) button appearance", () => {
    render(<Header summary={{ comparePastMonth: 12, totalSpent: 1200, dailyAverage: 40, transactionCount: 5, topCategory: "Food" }} />);

    expect(screen.getByTestId("mock-sia-ask-button")).toHaveAttribute("data-tone", "");
  });

  it("still renders the button when comparePastMonth data is insufficient (null)", () => {
    render(<Header summary={{ comparePastMonth: null }} />);

    expect(screen.getByTestId("mock-sia-ask-button")).toBeInTheDocument();
  });

  it("does not alter the existing Spending Trend text/calculations", () => {
    render(<Header summary={{ comparePastMonth: 15, totalSpent: 900 }} />);

    expect(screen.getByText(/15% higher than last month/i)).toBeInTheDocument();
  });
});
