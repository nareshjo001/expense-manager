import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import BudgetIntelligence from "./BudgetIntelligence";

afterEach(() => {
  cleanup();
});

describe("monthlyInsights/BudgetIntelligence", () => {
  it("renders budget insight content without an Ask SIA action", () => {
    render(
      <BudgetIntelligence
        data={{
          budgetInsights: { type: "SAFE", title: "On track", message: "Looking good.", tip: "Keep it up." },
          utilization: 40,
          spent: 400,
          budget: 1000,
        }}
      />
    );

    expect(screen.getByText("On track")).toBeInTheDocument();
    expect(screen.getByText("Looking good.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ask SIA/i })).not.toBeInTheDocument();
  });

  it("keeps the default no-data insight state without an Ask SIA action", () => {
    render(<BudgetIntelligence data={undefined} />);

    expect(screen.getByText("No Budget Insights Yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ask SIA/i })).not.toBeInTheDocument();
  });
});
