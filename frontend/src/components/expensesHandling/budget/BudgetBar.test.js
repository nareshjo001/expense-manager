import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import { format } from "date-fns";
import BudgetBar from "./BudgetBar";

// Phase C.2 -- proves BudgetBar's calm "Budget is refreshing" indicator
const CURRENT_MONTH = format(new Date(), "MMM yyyy");

afterEach(() => {
  cleanup();
});

describe("BudgetBar -- Phase C.2 stale-state indicator", () => {
  const monthlyBudgets = [{ month: CURRENT_MONTH, budget: 5000, spent: 1200 }];

  it("does not render the refreshing note by default (isStale omitted)", () => {
    render(<BudgetBar monthlyBudgets={monthlyBudgets} />);

    expect(screen.queryByText(/budget is refreshing/i)).not.toBeInTheDocument();
  });

  it("does not render the refreshing note when isStale is false", () => {
    render(<BudgetBar monthlyBudgets={monthlyBudgets} isStale={false} />);

    expect(screen.queryByText(/budget is refreshing/i)).not.toBeInTheDocument();
  });

  it("renders a calm refreshing note when isStale is true, without hiding the existing spent/budget values", () => {
    render(<BudgetBar monthlyBudgets={monthlyBudgets} isStale={true} />);

    expect(screen.getByText(/budget is refreshing/i)).toBeInTheDocument();
    // The existing best-available percentage is still shown (bar-circle text).
    expect(screen.getByText("24%")).toBeInTheDocument();
  });

  it("exposes the refreshing note with an accessible status role", () => {
    render(<BudgetBar monthlyBudgets={monthlyBudgets} isStale={true} />);

    expect(screen.getByRole("status")).toHaveTextContent(/budget is refreshing/i);
  });
});
