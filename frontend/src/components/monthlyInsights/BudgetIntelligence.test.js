import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import BudgetIntelligence from "./BudgetIntelligence";

// Batch 3G placement test: proves BudgetIntelligence renders exactly one
// shared SiaAskButton wired to the exact centrally-registered
// suggestionId/label pair the spec requires.
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

afterEach(() => {
  cleanup();
});

describe("monthlyInsights/BudgetIntelligence -- contextual SIA button (Batch 3G)", () => {
  it("renders exactly one SiaAskButton wired to the budget-status suggestion", () => {
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

    const buttons = screen.getAllByTestId("mock-sia-ask-button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute("data-suggestion-id", "budget-status");
    expect(buttons[0]).toHaveAttribute("data-label", "Ask SIA about my budget");
  });

  // Batch 3G remediation: this card's inner report card keeps a hard-coded
  // white background in both themes, so the shared button must opt out of
  // its default `color: inherit` (which would otherwise turn near-white in
  // dark theme) and use the fixed-readable "light-surface" appearance --
  // see SiaAskButton.js/.css for the mechanism.
  it("wires the light-surface tone so the button stays readable on this card's fixed-white background in both themes", () => {
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

    expect(screen.getByTestId("mock-sia-ask-button")).toHaveAttribute("data-tone", "light-surface");
  });

  it("still renders the button for the default no-data insight state", () => {
    render(<BudgetIntelligence data={undefined} />);

    expect(screen.getByTestId("mock-sia-ask-button")).toBeInTheDocument();
    expect(screen.getByText("No Budget Insights Yet")).toBeInTheDocument();
  });
});
