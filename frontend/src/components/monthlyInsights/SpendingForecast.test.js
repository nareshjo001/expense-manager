import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import SpendingForecast from "./SpendingForecast";

const currentMonthForecast = (overrides = {}) => ({
  hasData: true,
  targetMonth: "2026-08",
  spentSoFar: 13600,
  expectedRemaining: 4900,
  estimate: 18500,
  range: { lower: 16200, upper: 24800 },
  historyMonthsUsed: 5,
  dataQuality: { status: "limited", completedMonths: 5 },
  budgetRisk: {
    status: "safe",
    budgetAmount: 25000,
    predictedUtilizationPercentage: 74,
    predictedRemaining: 6500,
  },
  categories: [
    { category: "Food", actualAmount: 6000, expectedRemaining: 2500, projectedAmount: 8500, sharePercentage: 46 },
    { category: "Bills", actualAmount: 5000, expectedRemaining: 1500, projectedAmount: 6500, sharePercentage: 35 },
  ],
  adjustments: { historical: [], current: [] },
  ...overrides,
});

const renderWith = (current, retained = {}) =>
  render(
    <SpendingForecast
      report={{
        forecast: {
          currentMonthForecast: current,
          // Conflicting retained values prove the UI does not use them.
          nextCalendarMonthForecast: { hasData: true, targetMonth: "2026-09", estimate: 999999 },
          nextMonthForecast: { hasData: true, estimate: 888888 },
          ...retained,
        },
      }}
    />
  );

describe("SpendingForecast current-month redesign", () => {
  it("shows the current target month, actual, expected remaining, total and range", () => {
    renderWith(currentMonthForecast());
    expect(screen.getByText("Projected spending · August 2026")).toBeInTheDocument();
    expect(screen.getByText("₹18,500")).toBeInTheDocument();
    expect(screen.getByText("₹13,600")).toBeInTheDocument();
    expect(screen.getByText("₹4,900")).toBeInTheDocument();
    expect(screen.getByText("₹16,200")).toBeInTheDocument();
    expect(screen.getByText("₹24,800")).toBeInTheDocument();
    expect(screen.queryByText("₹9,99,999")).not.toBeInTheDocument();
    expect(screen.queryByText(/September 2026/)).not.toBeInTheDocument();
  });

  it("renders current-month budget risk", () => {
    renderWith(currentMonthForecast());
    expect(screen.getByText(/₹25,000 budget/)).toBeInTheDocument();
    expect(screen.getByText(/74% projected/)).toBeInTheDocument();
    expect(screen.getByText("On track")).toBeInTheDocument();
  });

  it("shows projected categories with actual and expected remaining amounts", () => {
    renderWith(currentMonthForecast());
    const toggle = screen.getByRole("button", { name: /Projected by category/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Expand")).toBeInTheDocument();
    expect(screen.queryByText("Food")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Collapse")).toBeInTheDocument();
    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.getByText("₹6,000 spent · ₹2,500 expected")).toBeInTheDocument();
    expect(screen.getByText("₹8,500 · 46%")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Food")).not.toBeInTheDocument();
  });

  it("does not expose internal forecast adjustments in the UI", () => {
    renderWith(
      currentMonthForecast({
        adjustments: {
          historical: [{ expenseName: "Mobile", originalAmount: 35000, excludedAmount: 31000 }],
          current: [{ expenseName: "Laptop", originalAmount: 40000, excludedAmount: 36000 }],
        },
      })
    );
    expect(screen.queryByText("One-time spending handled carefully")).not.toBeInTheDocument();
    expect(screen.queryByText("See forecast adjustments")).not.toBeInTheDocument();
    expect(screen.queryByText("Mobile")).not.toBeInTheDocument();
    expect(screen.queryByText("Laptop")).not.toBeInTheDocument();
  });

  it("fails closed on an unknown quality status", () => {
    renderWith(currentMonthForecast({ dataQuality: { status: "unexpected" } }));
    expect(screen.getByText("History quality unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Sufficient history")).not.toBeInTheDocument();
  });

  it("shows insufficient history without inventing a projection", () => {
    renderWith({
      hasData: false,
      historyMonthsUsed: 2,
      spentSoFar: 1200,
      estimate: null,
      categories: [],
    });
    expect(screen.getByText("Not enough history yet")).toBeInTheDocument();
    expect(screen.getByText(/after three complete months/)).toBeInTheDocument();
  });

  it("treats a missing current-month contract as temporarily unavailable", () => {
    render(<SpendingForecast report={{ forecast: {} }} />);
    expect(screen.getByText("Forecast temporarily unavailable")).toBeInTheDocument();
  });

  it("keeps accessible structure and clamps category bar width", () => {
    const { container } = renderWith(
      currentMonthForecast({
        categories: [
          { category: "Odd", actualAmount: 100, expectedRemaining: 0, projectedAmount: 100, sharePercentage: 180 },
        ],
      })
    );
    expect(screen.getByRole("region", { name: "Month-end Forecast" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Projected by category/i }));
    expect(container.querySelector(".forecast-bar-fill")).toHaveStyle({ width: "100%" });
  });
});
