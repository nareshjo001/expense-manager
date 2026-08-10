import React from "react";
import { render, screen, cleanup, within } from "@testing-library/react";
import AnomalyInsights from "./AnomalyInsights";

// Anomaly Detection Layer V1 -- Unusual Spending section.
//
// Renders the REAL component against report shapes the backend genuinely
// produces (see backend/analytics/analyzers/expenseAnomalyAnalyzer.js) --
// nothing about anomaly detection is mocked, so these assert user-visible
// behavior rather than internal props.

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
  baseline: { scope: "category", sampleCount: 18, medianAmount: 500 },
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
  eligibleCategoryCount: 2,
  insufficientHistoryCategoryCount: 0,
  flaggedCount: 1,
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
  it("renders a complete explanation built from amountRatio, medianAmount, category and sampleCount", () => {
    renderWith(availableAnomalies());

    expect(
      screen.getByText("₹3,500 was 7× your typical Food expense of ₹500, based on 18 previous expenses.")
    ).toBeInTheDocument();
  });

  it("formats INR amounts using en-IN grouping regardless of runtime locale", () => {
    const anomalies = availableAnomalies({
      anomalies: [
        flaggedRecord({
          expenseId: "exp-2",
          amount: 150000,
          baseline: { scope: "category", sampleCount: 12, medianAmount: 20000 },
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

  it("singularizes the sample count when exactly one previous expense exists", () => {
    const anomalies = availableAnomalies({
      anomalies: [
        flaggedRecord({
          baseline: { scope: "category", sampleCount: 1, medianAmount: 500 },
        }),
      ],
    });
    renderWith(anomalies);

    expect(screen.getByText(/based on 1 previous expense\./)).toBeInTheDocument();
  });

  it("falls back to a concise, still-honest explanation when baseline/detection numbers are missing", () => {
    const anomalies = availableAnomalies({
      anomalies: [flaggedRecord({ baseline: undefined, detection: undefined })],
    });
    renderWith(anomalies);

    expect(screen.getByText("₹3,500 is unusual compared with your recent Food spending.")).toBeInTheDocument();
  });

  it("shows the expense date in the project's established DD Mon YYYY style", () => {
    renderWith(availableAnomalies());

    expect(screen.getByText(/15 Aug 2026/)).toBeInTheDocument();
  });

  it("never uses the words fraud, suspicious, or dangerous anywhere in the section", () => {
    const { container } = renderWith(availableAnomalies());

    expect(container.textContent).not.toMatch(/fraud|suspicious|dangerous/i);
  });

  it("includes the calm clarification that unusual does not mean incorrect", () => {
    renderWith(availableAnomalies());

    expect(
      screen.getByText(/Unusual does not necessarily mean incorrect.*only differs from your recent spending pattern/)
    ).toBeInTheDocument();
  });
});

describe("AnomalyInsights -- severity labels", () => {
  it.each([
    ["moderate", "Moderate"],
    ["high", "High"],
    ["very_high", "Very high"],
  ])("renders the %s severity as %s", (severity, label) => {
    renderWith(availableAnomalies({ anomalies: [flaggedRecord({ severity })] }));

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("omits the severity badge rather than showing a raw/unknown code", () => {
    renderWith(availableAnomalies({ anomalies: [flaggedRecord({ severity: "totally-unknown" })] }));

    expect(screen.queryByText("totally-unknown")).not.toBeInTheDocument();
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
    expect(screen.getByText(/at least 10 earlier expenses in the same category/i)).toBeInTheDocument();
  });

  it("shows a positive, factual message for a valid zero-anomaly result", () => {
    renderWith({ hasData: true, reasonCode: null, flaggedCount: 0, anomalies: [] });

    expect(screen.getByText("No unusual expenses were detected this month.")).toBeInTheDocument();
  });

  it("treats a missing anomalies block as unavailable, never as 'no anomalies found'", () => {
    render(<AnomalyInsights report={{}} />);

    expect(screen.getByText(/Unusual-spending insights are unavailable right now/i)).toBeInTheDocument();
    expect(screen.queryByText(/No unusual expenses were detected/i)).not.toBeInTheDocument();
  });

  it("does not crash when the whole report is missing", () => {
    expect(() => render(<AnomalyInsights report={undefined} />)).not.toThrow();
    expect(screen.getByText(/Unusual-spending insights are unavailable right now/i)).toBeInTheDocument();
  });

  it("does not crash on a malformed anomalies section and does not claim normal spending", () => {
    expect(() => render(<AnomalyInsights report={{ anomalies: "nonsense" }} />)).not.toThrow();
    expect(screen.getByText(/Unusual-spending insights are unavailable right now/i)).toBeInTheDocument();
  });

  it("treats an unrecognised hasData:false reason code as unavailable, not as normal spending", () => {
    renderWith({ hasData: false, reasonCode: "SOME_FUTURE_REASON", anomalies: [] });

    expect(screen.getByText(/Unusual-spending insights are unavailable right now/i)).toBeInTheDocument();
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
    expect(screen.getByText(/^1 unusual expense found this month/)).toBeInTheDocument();
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

    const section = screen.getByRole("region", { name: "Unusual Spending" });
    expect(section).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Unusual Spending" })).toBeInTheDocument();
  });

  it("contains no focusable controls, so it introduces no keyboard traps", () => {
    const { container } = renderWith(availableAnomalies());

    expect(container.querySelectorAll("button, a, input, select, textarea, [tabindex]")).toHaveLength(0);
  });
});
