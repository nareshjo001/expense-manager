import React from "react";
import { render, screen, cleanup, within } from "@testing-library/react";
import AnomalyInsights from "./AnomalyInsights";

// Material, history-based spending-review section.

afterEach(() => {
  cleanup();
});

const flaggedRecord = (overrides = {}) => ({
  expenseId: "exp-1",
  expenseName: "Dinner",
  category: "Food",
  amount: 3500,
  expenseDate: "2026-08-15T00:00:00.000Z",
  severity: "high",
  reasonCode: "CATEGORY_AMOUNT_SPIKE",
  baseline: { scope: "category", sampleCount: 18, monthCount: 6, medianAmount: 500 },
  impact: {
    excessAmount: 3000,
    monthlyReferenceAmount: 15000,
    monthlyReferenceSource: "current_budget",
    percentage: 20,
  },
  detection: {
    method: "MODIFIED_Z",
    score: 12.6,
    threshold: 3.5,
    thresholdMultiple: 3.6,
    amountRatio: 7,
  },
  ...overrides,
});

const availableAnomalies = (overrides = {}) => ({
  hasData: true,
  reasonCode: null,
  baselineWindow: { months: 12, start: "2025-08-01T00:00:00.000Z", endExclusive: "2026-08-01T00:00:00.000Z" },
  evaluatedExpenseCount: 10,
  comparedExpenseCount: 8,
  uncomparableExpenseCount: 2,
  eligibleCategoryCount: 2,
  insufficientHistoryCategoryCount: 0,
  flaggedCount: 1,
  displayedCount: 1,
  anomalies: [flaggedRecord()],
  ...overrides,
});

const renderWith = (anomalies) => render(<AnomalyInsights report={{ anomalies }} />);

describe("AnomalyInsights -- contract path", () => {
  it("reads flagged records from report.anomalies.anomalies", () => {
    renderWith(availableAnomalies());

    expect(screen.getByText("Dinner")).toBeInTheDocument();
    expect(screen.getByText("₹3,500")).toBeInTheDocument();
  });

  it("does not read from report.anomalies.records, even when that key is present with different data", () => {
    const anomalies = availableAnomalies();
    // A decoy `records` key with a distinctive value that must never
    // appear on screen -- proves the component never reads it.
    anomalies.records = [
      { expenseId: "decoy", category: "Decoy", amount: 999999, expenseDate: "2026-01-01T00:00:00.000Z", severity: "high" },
    ];
    const { container } = renderWith(anomalies);

    expect(screen.getByText("₹3,500")).toBeInTheDocument();
    expect(container.textContent).not.toContain("Decoy");
    expect(container.textContent).not.toContain("999,999");
  });
});

describe("AnomalyInsights -- flagged-expense explanation", () => {
  it("explains the usual amount, evidence coverage, and monthly impact without statistical jargon", () => {
    renderWith(availableAnomalies());

    expect(screen.getByText("7× usual")).toBeInTheDocument();
    expect(screen.getByText("₹3,500 was ₹3,000 above your usual ₹500 Food purchase.")).toBeInTheDocument();
    expect(screen.getByText("Compared with 18 previous Food purchases across 6 months.")).toBeInTheDocument();
    expect(screen.getByText("The extra amount equals about 20% of this month's budget.")).toBeInTheDocument();
  });

  it("formats INR amounts using en-IN grouping regardless of runtime locale", () => {
    const anomalies = availableAnomalies({
      anomalies: [
        flaggedRecord({
          expenseId: "exp-2",
          amount: 150000,
          baseline: { scope: "category", sampleCount: 12, monthCount: 5, medianAmount: 20000 },
          impact: {
            excessAmount: 130000,
            monthlyReferenceAmount: 500000,
            monthlyReferenceSource: "historical_monthly_spending",
            percentage: 26,
          },
          detection: { method: "MODIFIED_Z", score: 5, threshold: 3.5, thresholdMultiple: 1.4, amountRatio: 7.5 },
        }),
      ],
    });
    renderWith(anomalies);

    expect(screen.getByText("₹1,50,000")).toBeInTheDocument();
    // "₹20,000" (the baseline median) only appears inside the longer
    // explanation sentence, not as its own standalone text node.
    expect(screen.getByText(/₹20,000/)).toBeInTheDocument();
  });

  it("uses a matching expense name when a name-specific baseline was selected", () => {
    const anomalies = availableAnomalies({
      anomalies: [
        flaggedRecord({
          baseline: { scope: "expense_name", sampleCount: 4, monthCount: 3, medianAmount: 500 },
        }),
      ],
    });
    renderWith(anomalies);

    expect(screen.getByText(/usual ₹500 Dinner purchase/)).toBeInTheDocument();
    expect(screen.getByText("Compared with 4 previous Dinner purchases across 3 months.")).toBeInTheDocument();
  });

  it("falls back to a concise, still-honest explanation when baseline/detection numbers are missing", () => {
    const anomalies = availableAnomalies({
      anomalies: [flaggedRecord({ baseline: undefined, detection: undefined })],
    });
    renderWith(anomalies);

    expect(screen.getByText("₹3,500 was meaningfully higher than your usual Food purchase.")).toBeInTheDocument();
  });

  it("shows the expense date in the project's established DD Mon YYYY style", () => {
    renderWith(availableAnomalies());

    expect(screen.getByText(/15 Aug 2026/)).toBeInTheDocument();
  });

  it("never labels a purchase as suspicious or dangerous", () => {
    const { container } = renderWith(availableAnomalies());

    expect(container.textContent).not.toMatch(/suspicious|dangerous/i);
  });

  it("clearly says this is a pattern comparison rather than an error or fraud alert", () => {
    renderWith(availableAnomalies());

    expect(screen.getByText(/pattern comparisons, not error or fraud alerts/i)).toBeInTheDocument();
  });
});

describe("AnomalyInsights -- useful labels", () => {
  it("does not expose the legacy severity classification", () => {
    renderWith(availableAnomalies({ anomalies: [flaggedRecord({ severity: "very_high" })] }));

    expect(screen.queryByText(/very high/i)).not.toBeInTheDocument();
    expect(screen.getByText("7× usual")).toBeInTheDocument();
  });
});

describe("AnomalyInsights -- no-data / empty states", () => {
  it("explains NO_ELIGIBLE_CURRENT_EXPENSES without claiming normal spending", () => {
    renderWith({ hasData: false, reasonCode: "NO_ELIGIBLE_CURRENT_EXPENSES", anomalies: [] });

    expect(screen.getByText(/No expenses to check yet this month/i)).toBeInTheDocument();
    expect(screen.getByText(/no eligible expenses recorded this month/i)).toBeInTheDocument();
  });

  it("explains NO_BASELINE_YET with the real minimum sample requirement", () => {
    renderWith({ hasData: false, reasonCode: "NO_BASELINE_YET", anomalies: [] });

    expect(screen.getByText(/Still building your spending history/i)).toBeInTheDocument();
    expect(screen.getByText(/More matching purchase history is needed/i)).toBeInTheDocument();
  });

  it("shows a positive, factual message for a valid zero-anomaly result", () => {
    renderWith({
      hasData: true,
      reasonCode: null,
      evaluatedExpenseCount: 5,
      comparedExpenseCount: 3,
      uncomparableExpenseCount: 2,
      flaggedCount: 0,
      anomalies: [],
    });

    expect(screen.getByText("No material spending changes found among 3 comparable expenses.")).toBeInTheDocument();
    expect(screen.getByText(/2 expenses did not yet have enough matching history/i)).toBeInTheDocument();
  });

  it("treats a missing anomalies block as unavailable, never as 'no anomalies found'", () => {
    render(<AnomalyInsights report={{}} />);

    expect(screen.getByText(/Spending review is unavailable right now/i)).toBeInTheDocument();
    expect(screen.queryByText(/No material spending changes found/i)).not.toBeInTheDocument();
  });

  it("does not crash when the whole report is missing", () => {
    expect(() => render(<AnomalyInsights report={undefined} />)).not.toThrow();
    expect(screen.getByText(/Spending review is unavailable right now/i)).toBeInTheDocument();
  });

  it("does not crash on a malformed anomalies section and does not claim normal spending", () => {
    expect(() => render(<AnomalyInsights report={{ anomalies: "nonsense" }} />)).not.toThrow();
    expect(screen.getByText(/Spending review is unavailable right now/i)).toBeInTheDocument();
  });

  it("treats an unrecognised hasData:false reason code as unavailable, not as normal spending", () => {
    renderWith({ hasData: false, reasonCode: "SOME_FUTURE_REASON", anomalies: [] });

    expect(screen.getByText(/Spending review is unavailable right now/i)).toBeInTheDocument();
  });
});

describe("AnomalyInsights -- malformed individual records", () => {
  it("omits a record missing amount/category without crashing or showing NaN/undefined", () => {
    const anomalies = availableAnomalies({
      flaggedCount: 2,
      anomalies: [
        flaggedRecord({ expenseId: "good" }),
        { expenseId: "bad", category: null, amount: "not-a-number" },
      ],
    });
    const { container } = renderWith(anomalies);

    expect(container.textContent).not.toMatch(/NaN|undefined/);
    // Only the one genuinely renderable record is counted in the summary,
    // even though the backend's own flaggedCount says 2.
    expect(screen.getByText(/^1 material spending change found/)).toBeInTheDocument();
  });

  it("never renders the literal string 'Invalid Date' for a malformed expenseDate", () => {
    const anomalies = availableAnomalies({
      anomalies: [flaggedRecord({ expenseDate: "not-a-real-date" })],
    });
    const { container } = renderWith(anomalies);

    expect(container.textContent).not.toContain("Invalid Date");
  });

  it("falls back to the category as the visible name when expenseName is missing", () => {
    const anomalies = availableAnomalies({
      anomalies: [flaggedRecord({ expenseName: "" })],
    });
    renderWith(anomalies);

    const list = screen.getByRole("list");
    expect(within(list).getByText("Food")).toBeInTheDocument();
  });

  it("does not crash when the entire anomalies array is malformed", () => {
    expect(() =>
      render(<AnomalyInsights report={{ anomalies: { hasData: true, reasonCode: null, anomalies: "nonsense" } }} />)
    ).not.toThrow();
  });
});

describe("AnomalyInsights -- ordering and purity", () => {
  it("preserves the backend-provided anomaly ordering", () => {
    const anomalies = availableAnomalies({
      anomalies: [
        flaggedRecord({ expenseId: "first", expenseName: "First Item", amount: 1000 }),
        flaggedRecord({ expenseId: "second", expenseName: "Second Item", amount: 5000 }),
        flaggedRecord({ expenseId: "third", expenseName: "Third Item", amount: 2000 }),
      ],
    });
    renderWith(anomalies);

    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText("First Item")).toBeInTheDocument();
    expect(within(items[1]).getByText("Second Item")).toBeInTheDocument();
    expect(within(items[2]).getByText("Third Item")).toBeInTheDocument();
  });

  it("does not mutate the report or the anomaly array it receives", () => {
    const anomalies = availableAnomalies();
    const snapshot = JSON.parse(JSON.stringify(anomalies));
    const report = { anomalies };

    render(<AnomalyInsights report={report} />);

    expect(anomalies).toEqual(snapshot);
  });

  it("does not throw when the input report and anomaly array are frozen", () => {
    const record = Object.freeze(flaggedRecord());
    const anomalies = Object.freeze({
      hasData: true,
      reasonCode: null,
      flaggedCount: 1,
      anomalies: Object.freeze([record]),
    });
    const report = Object.freeze({ anomalies });

    expect(() => render(<AnomalyInsights report={report} />)).not.toThrow();
  });
});

describe("AnomalyInsights -- accessibility and structure", () => {
  it("exposes the section with an accessible heading", () => {
    renderWith(availableAnomalies());

    const section = screen.getByRole("region", { name: "Spending Worth Reviewing" });
    expect(section).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Spending Worth Reviewing" })).toBeInTheDocument();
  });

  it("contains no focusable controls, so it introduces no keyboard traps", () => {
    const { container } = renderWith(availableAnomalies());

    expect(container.querySelectorAll("button, a, input, select, textarea, [tabindex]")).toHaveLength(0);
  });
});
