import React from "react";
import { render, screen, cleanup, within } from "@testing-library/react";
import SpendingForecast from "./SpendingForecast";

// Prediction Layer V1: Spending Forecast section.
//
// Renders the REAL component against report shapes the backend genuinely
// produces (see backend/analytics/analyzers/forecastAnalyzer.js) -- nothing
// about the forecast is mocked, so these assert user-visible behavior
// rather than internal props.

afterEach(() => {
  cleanup();
});

const availableForecast = (overrides = {}) => ({
  hasData: true,
  method: "ROBUST_TREND_MEDIAN_V2",
  historyMonthsAvailable: 8,
  targetMonth: "2026-09",
  dataQuality: {
    status: "sufficient",
    completedMonths: 8,
    activeDays: 96,
    method: "ROBUST_TREND_MEDIAN_V2",
    warnings: [],
  },
  // LEGACY field: deliberately a CONFLICTING value throughout this suite.
  // It projects the CURRENT, in-progress month despite its name, so any
  // assertion that sees 12,500 proves the UI read the true next-calendar
  // field and never fell back to this one.
  nextMonthForecast: {
    hasData: true,
    reasonCode: null,
    estimate: 999999,
    range: { lower: 900000, upper: 1100000 },
    historyMonthsUsed: 8,
    horizonMonths: 1,
  },
  nextCalendarMonthForecast: {
    hasData: true,
    reasonCode: null,
    targetMonth: "2026-09",
    estimate: 12500,
    range: { lower: 11000, upper: 14000 },
    historyMonthsUsed: 8,
    horizonMonths: 1,
    categories: [
      { category: "Food", predictedAmount: 6000, sharePercentage: 48, method: "CATEGORY_ROBUST_TREND" },
      { category: "Travel", predictedAmount: 4000, sharePercentage: 32, method: "CATEGORY_ROBUST_TREND" },
      { category: "Bills", predictedAmount: 2500, sharePercentage: 20, method: "CATEGORY_SMOOTHED_SHARE" },
    ],
    categoriesReasonCode: null,
  },
  nextQuarterForecast: {
    hasData: true,
    reasonCode: null,
    estimate: 38000,
    range: { lower: 33000, upper: 43000 },
    historyMonthsUsed: 8,
    horizonMonths: 3,
  },
  nextYearForecast: {
    hasData: false,
    reasonCode: "INSUFFICIENT_HISTORY_FOR_NEXT_YEAR",
    estimate: null,
    range: null,
    historyMonthsUsed: 8,
    horizonMonths: 12,
  },
  budgetRisk: {
    status: "watch",
    budgetAmount: 15000,
    predictedUtilizationPercentage: 83.33,
    predictedRemaining: 2500,
  },
  ...overrides,
});

const renderWith = (forecast) => render(<SpendingForecast report={{ forecast }} />);

describe("SpendingForecast -- available forecast", () => {
  it("renders the predicted total, the range and the target month", () => {
    renderWith(availableForecast());

    expect(screen.getByText("₹12,500")).toBeInTheDocument();
    expect(screen.getByText(/September 2026/)).toBeInTheDocument();
    expect(screen.getByText("₹11,000")).toBeInTheDocument();
    expect(screen.getByText("₹14,000")).toBeInTheDocument();
  });

  // Prediction Layer V1 remediation: the decisive conflicting-value proof.
  it("renders ONLY the true next-calendar value, never the conflicting legacy current-month one", () => {
    const { container } = renderWith(availableForecast());

    expect(screen.getByText("₹12,500")).toBeInTheDocument();
    // The legacy field's distinctive value appears nowhere on screen.
    expect(container.textContent).not.toContain("999,999");
    expect(container.textContent).not.toContain("999999");
  });

  it("labels the figure as the next calendar month", () => {
    renderWith(availableForecast());

    expect(screen.getByText(/next month/i)).toBeInTheDocument();
    expect(screen.getByText(/September 2026/)).toBeInTheDocument();
  });

  it("does not fall back to the legacy field when the true next-calendar field is missing", () => {
    const forecast = availableForecast();
    // Legacy stays healthy and available; the true field is gone.
    delete forecast.nextCalendarMonthForecast;
    const { container } = renderWith(forecast);

    expect(screen.getByText("Forecast temporarily unavailable")).toBeInTheDocument();
    expect(container.textContent).not.toContain("999,999");
  });

  it("does not fall back to the legacy field when the true next-calendar field is malformed", () => {
    const forecast = availableForecast();
    forecast.nextCalendarMonthForecast = "nonsense";
    const { container } = renderWith(forecast);

    expect(screen.getByText("Forecast temporarily unavailable")).toBeInTheDocument();
    expect(container.textContent).not.toContain("999,999");
  });

  it("always states that forecasts are estimates rather than guarantees", () => {
    renderWith(availableForecast());

    expect(screen.getByText(/estimates based on your own spending history, not guarantees/i)).toBeInTheDocument();
  });

  it("never displays an accuracy or confidence percentage, because none is measured", () => {
    const { container } = renderWith(availableForecast());

    expect(container.textContent).not.toMatch(/accuracy|confidence|certaint/i);
  });

  it("avoids misleading precision by showing whole rupees only", () => {
    const forecast = availableForecast();
    forecast.nextCalendarMonthForecast.estimate = 12500.47;
    const { container } = renderWith(forecast);

    expect(screen.getByText("₹12,500")).toBeInTheDocument();
    expect(container.textContent).not.toContain("12,500.47");
  });
});

describe("SpendingForecast -- dynamic category rendering", () => {
  it("renders every category the backend supplies, with amount and share as text", () => {
    renderWith(availableForecast());

    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);

    expect(within(items[0]).getByText("Food")).toBeInTheDocument();
    expect(within(items[0]).getByText(/₹6,000 · 48%/)).toBeInTheDocument();
  });

  it("handles a completely different, variable number of categories with no fixed list", () => {
    const forecast = availableForecast();
    forecast.nextCalendarMonthForecast.categories = [
      { category: "Pet Grooming", predictedAmount: 700, sharePercentage: 70, method: "CATEGORY_ROBUST_TREND" },
      { category: "Stationery", predictedAmount: 300, sharePercentage: 30, method: "CATEGORY_SMOOTHED_SHARE" },
    ];
    renderWith(forecast);

    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(screen.getByText("Pet Grooming")).toBeInTheDocument();
    expect(screen.getByText("Stationery")).toBeInTheDocument();
  });

  it("omits the breakdown entirely when the backend supplies no categories", () => {
    const forecast = availableForecast();
    forecast.nextCalendarMonthForecast.categories = [];
    forecast.nextCalendarMonthForecast.categoriesReasonCode = "NO_CATEGORY_BREAKDOWN_AVAILABLE";
    renderWith(forecast);

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    // The headline estimate is still shown -- a missing breakdown never
    // hides the forecast itself.
    expect(screen.getByText("₹12,500")).toBeInTheDocument();
  });
});

describe("SpendingForecast -- horizon visibility rules", () => {
  it("shows a longer horizon only when the backend marks it available", () => {
    renderWith(availableForecast());

    expect(screen.getByText("Next 3 months")).toBeInTheDocument();
    // nextYear is hasData:false in the fixture -- it must not be rendered
    // at all, and certainly not with a guessed number.
    expect(screen.queryByText("Next 12 months")).not.toBeInTheDocument();
  });

  it("hides the entire longer-horizon block when neither horizon is available", () => {
    const forecast = availableForecast();
    forecast.nextQuarterForecast.hasData = false;
    forecast.nextQuarterForecast.estimate = null;
    renderWith(forecast);

    expect(screen.queryByText("Looking further ahead")).not.toBeInTheDocument();
  });

  it("shows both longer horizons when both are available", () => {
    const forecast = availableForecast();
    forecast.nextYearForecast = {
      hasData: true,
      reasonCode: null,
      estimate: 150000,
      range: { lower: 130000, upper: 170000 },
      historyMonthsUsed: 12,
      horizonMonths: 12,
    };
    renderWith(forecast);

    expect(screen.getByText("Next 3 months")).toBeInTheDocument();
    expect(screen.getByText("Next 12 months")).toBeInTheDocument();
    expect(screen.getByText("₹1,50,000")).toBeInTheDocument();
  });
});

describe("SpendingForecast -- budget risk states", () => {
  it("communicates risk with a text label, never colour alone", () => {
    renderWith(availableForecast());

    // The status is fully readable as words.
    expect(screen.getByText("Worth watching")).toBeInTheDocument();
    expect(screen.getByText(/about 83% of it/i)).toBeInTheDocument();
  });

  it("states plainly when the prediction would exceed the budget", () => {
    const forecast = availableForecast();
    forecast.budgetRisk = {
      status: "high",
      budgetAmount: 10000,
      predictedUtilizationPercentage: 125,
      predictedRemaining: -2500,
    };
    renderWith(forecast);

    expect(screen.getByText("Likely over budget")).toBeInTheDocument();
    expect(screen.getByText(/roughly ₹2,500 over budget/i)).toBeInTheDocument();
  });

  it("shows the on-track label for a safe prediction", () => {
    const forecast = availableForecast();
    forecast.budgetRisk = {
      status: "safe",
      budgetAmount: 30000,
      predictedUtilizationPercentage: 41.67,
      predictedRemaining: 17500,
    };
    renderWith(forecast);

    expect(screen.getByText("On track")).toBeInTheDocument();
    expect(screen.getByText(/leave roughly ₹17,500 unspent/i)).toBeInTheDocument();
  });

  it("explains that no budget applies rather than inventing a comparison", () => {
    const forecast = availableForecast();
    forecast.budgetRisk = {
      status: "no_budget",
      budgetAmount: null,
      predictedUtilizationPercentage: null,
      predictedRemaining: null,
    };
    const { container } = renderWith(forecast);

    expect(screen.getByText(/No budget has been set for this month yet/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/% of it/);
  });

  it("renders no budget block at all when the comparison is not computable", () => {
    const forecast = availableForecast();
    forecast.budgetRisk = {
      status: "insufficient_data",
      budgetAmount: null,
      predictedUtilizationPercentage: null,
      predictedRemaining: null,
    };
    renderWith(forecast);

    expect(screen.queryByText(/Against your budget/i)).not.toBeInTheDocument();
    expect(screen.getByText("₹12,500")).toBeInTheDocument();
  });
});

describe("SpendingForecast -- history and failure states", () => {
  it("shows the limited-history badge with the real month count", () => {
    const forecast = availableForecast();
    forecast.dataQuality = {
      status: "limited",
      completedMonths: 3,
      activeDays: 22,
      method: "ROBUST_TREND_MEDIAN_V2",
      warnings: ["LIMITED_HISTORY"],
    };
    renderWith(forecast);

    expect(screen.getByText("Limited history")).toBeInTheDocument();
    expect(screen.getByText("3 complete months used")).toBeInTheDocument();
  });

  it("shows the sufficient-history badge when history is adequate", () => {
    renderWith(availableForecast());

    expect(screen.getByText("Sufficient history")).toBeInTheDocument();
    expect(screen.getByText("8 complete months used")).toBeInTheDocument();
  });

  it("explains insufficient history with the real month count and no invented figure", () => {
    const { container } = renderWith(
      availableForecast({
        hasData: false,
        nextCalendarMonthForecast: {
          hasData: false,
          reasonCode: "INSUFFICIENT_HISTORY_FOR_NEXT_MONTH",
          estimate: null,
          range: null,
          historyMonthsUsed: 1,
          horizonMonths: 1,
          categories: [],
          categoriesReasonCode: "NO_CATEGORY_BREAKDOWN_AVAILABLE",
        },
        dataQuality: {
          status: "limited",
          completedMonths: 1,
          activeDays: 3,
          method: "ROBUST_TREND_MEDIAN_V2",
          warnings: ["LIMITED_HISTORY"],
        },
      })
    );

    expect(screen.getByText("Not enough history yet")).toBeInTheDocument();
    expect(screen.getByText(/there is 1 complete month of history/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/₹/);
  });

  it("treats a missing forecast section as a temporary service problem, not user error", () => {
    render(<SpendingForecast report={{}} />);

    expect(screen.getByText("Forecast temporarily unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Your expenses and budgets are unaffected/i)).toBeInTheDocument();
  });

  it("does not crash when the whole report is missing", () => {
    expect(() => render(<SpendingForecast report={undefined} />)).not.toThrow();
    expect(screen.getByText("Forecast temporarily unavailable")).toBeInTheDocument();
  });

  it("does not crash on a malformed forecast section", () => {
    expect(() => render(<SpendingForecast report={{ forecast: "nonsense" }} />)).not.toThrow();
    expect(screen.getByText("Forecast temporarily unavailable")).toBeInTheDocument();
  });
});

describe("SpendingForecast -- accessibility and structure", () => {
  it("exposes the section with an accessible heading", () => {
    renderWith(availableForecast());

    const section = screen.getByRole("region", { name: "Spending Forecast" });
    expect(section).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Spending Forecast" })).toBeInTheDocument();
  });

  it("keeps the decorative bars out of the accessibility tree, with text equivalents present", () => {
    const { container } = renderWith(availableForecast());

    const bars = container.querySelectorAll(".forecast-bar-track");
    expect(bars.length).toBe(3);
    for (const bar of bars) {
      expect(bar).toHaveAttribute("aria-hidden", "true");
    }
    // Every bar's information is also available as text.
    expect(screen.getByText(/₹6,000 · 48%/)).toBeInTheDocument();
    expect(screen.getByText(/₹4,000 · 32%/)).toBeInTheDocument();
    expect(screen.getByText(/₹2,500 · 20%/)).toBeInTheDocument();
  });

  it("contains no focusable controls, so it introduces no keyboard traps", () => {
    const { container } = renderWith(availableForecast());

    expect(container.querySelectorAll("button, a, input, select, textarea, [tabindex]")).toHaveLength(0);
  });

  it("clamps a bar width to the 0-100% range even for an out-of-range share", () => {
    const forecast = availableForecast();
    forecast.nextCalendarMonthForecast.categories = [
      { category: "Odd", predictedAmount: 100, sharePercentage: 180, method: "CATEGORY_ROBUST_TREND" },
    ];
    const { container } = renderWith(forecast);

    expect(container.querySelector(".forecast-bar-fill")).toHaveStyle({ width: "100%" });
  });
});
