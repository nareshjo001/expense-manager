import { fireEvent, render, screen } from "@testing-library/react";
import Insights from "./Insights";

jest.mock("./MonthlyInsightPage", () => () => <div data-testid="monthly-insight-page-view" />);
jest.mock("./Income/IncomeInsights", () => () => <div data-testid="income-insights-view" />);

describe("Insights -- Analysis mode toggle (Budgets / Income)", () => {
  it("starts on Budgets and renders the budget insights view", () => {
    render(<Insights />);

    expect(screen.getByTestId("monthly-insight-page-view")).toBeInTheDocument();
    expect(screen.queryByTestId("income-insights-view")).toBeNull();

    const budgetBtn = screen.getByRole("tab", { name: /budgets/i });
    const incomeBtn = screen.getByRole("tab", { name: /income/i });

    expect(budgetBtn).toHaveClass("active");
    expect(budgetBtn).toHaveAttribute("aria-selected", "true");
    expect(incomeBtn).not.toHaveClass("active");
    expect(incomeBtn).toHaveAttribute("aria-selected", "false");
  });

  it("switches to Income when clicked, moving the slider", () => {
    const { container } = render(<Insights />);
    const slider = container.querySelector(".analysis-toggle-slider");
    const incomeBtn = screen.getByRole("tab", { name: /income/i });

    fireEvent.click(incomeBtn);

    expect(screen.getByTestId("income-insights-view")).toBeInTheDocument();
    expect(screen.queryByTestId("monthly-insight-page-view")).toBeNull();
    expect(incomeBtn).toHaveClass("active");
    expect(incomeBtn).toHaveAttribute("aria-selected", "true");
    expect(slider).toHaveClass("right");

    // Click back to Budgets
    const budgetBtn = screen.getByRole("tab", { name: /budgets/i });
    fireEvent.click(budgetBtn);

    expect(screen.getByTestId("monthly-insight-page-view")).toBeInTheDocument();
    expect(screen.queryByTestId("income-insights-view")).toBeNull();
    expect(budgetBtn).toHaveClass("active");
    expect(slider).not.toHaveClass("right");
  });
});
