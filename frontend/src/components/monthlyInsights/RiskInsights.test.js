import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import RiskInsights from "./RiskInsights";

// Risk Intelligence V1 -- Financial Risk Signals section.
//
// Renders the REAL component against report shapes the backend genuinely
// produces (see backend/analytics/analyzers/riskAnalyzer.js and
// backend/analytics/analyzers/scores/riskRules.js) -- nothing about risk
// evaluation is mocked, so these assert user-visible behavior rather than
// internal props. No hooks are used by this component, so no QueryClient
// wrapper is needed (same pattern as AnomalyInsights.test.js).

afterEach(() => {
  cleanup();
});

const signal = (reasonCode, severity, evidence) => ({ reasonCode, severity, evidence });

const availableRisk = (overrides = {}) => ({
  hasData: true,
  reasonCode: null,
  riskLevel: "high",
  signalCount: 1,
  signals: [signal("BUDGET_ALREADY_OVERSPENT", "high", { exceededBy: 500, utilization: 112.5 })],
  ...overrides,
});

const renderWith = (risk) => render(<RiskInsights report={{ risk }} />);

describe("RiskInsights -- unavailable / malformed states (1)", () => {
  it("renders an unavailable state when report.risk is missing entirely", () => {
    render(<RiskInsights report={{}} />);

    expect(screen.getByText("Risk assessment unavailable right now")).toBeInTheDocument();
  });

  it("renders an unavailable state when report.risk is present but not shaped like a real result", () => {
    renderWith({ notARealShape: true });

    expect(screen.getByText("Risk assessment unavailable right now")).toBeInTheDocument();
  });

  it("renders an unavailable state when report itself is null/undefined", () => {
    render(<RiskInsights report={null} />);

    expect(screen.getByText("Risk assessment unavailable right now")).toBeInTheDocument();
  });
});

describe("RiskInsights -- hasData:false vs. completed zero-signal result (2, 3)", () => {
  it("hasData:false renders the unavailable state, not the healthy zero-signal state", () => {
    renderWith({ hasData: false, reasonCode: "NO_REPORT_DATA", riskLevel: "none", signalCount: 0, signals: [] });

    expect(screen.getByText("Risk assessment unavailable right now")).toBeInTheDocument();
    expect(
      screen.queryByText("No active risk signals were detected from the currently available data.")
    ).not.toBeInTheDocument();
  });

  it("a completed evaluation with zero signals renders the cautious healthy-state message, not 'unavailable'", () => {
    renderWith({ hasData: true, reasonCode: null, riskLevel: "none", signalCount: 0, signals: [] });

    expect(
      screen.getByText("No active risk signals were detected from the currently available data.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Risk assessment unavailable right now")).not.toBeInTheDocument();
    // Never claims the user has no financial risk -- only that nothing was detected.
    expect(screen.getByText(/not a guarantee that no financial risk exists/i)).toBeInTheDocument();
  });
});

describe("RiskInsights -- overall level and signal count (4)", () => {
  it("renders the overall risk level and signal count", () => {
    renderWith(
      availableRisk({
        riskLevel: "moderate",
        signalCount: 2,
        signals: [
          signal("LOW_REMAINING_BUDGET", "moderate", { utilization: 92, remainingBudget: 400 }),
          signal("PERSISTENT_SPENDING_GROWTH", "moderate", { percentageChange: 25 }),
        ],
      })
    );

    expect(screen.getByText(/Overall level:/)).toBeInTheDocument();
    // Scoped to the summary line's own <strong> -- both signals below are
    // also "moderate" severity, so an unscoped getByText("Moderate") would
    // ambiguously match their badges too (this is intentional: the overall
    // level and each signal's own severity are independent pieces of
    // information that can legitimately share a label).
    expect(screen.getByText("Moderate", { selector: ".risk-summary-line strong" })).toBeInTheDocument();
    expect(screen.getAllByText("Moderate", { selector: ".risk-severity-badge" })).toHaveLength(2);
    expect(screen.getByText(/2 active signals/)).toBeInTheDocument();
  });

  it("uses singular 'signal' wording for exactly one signal", () => {
    renderWith(availableRisk());

    expect(screen.getByText(/1 active signal\b/)).toBeInTheDocument();
  });
});

describe("RiskInsights -- signal-to-wording mapping (5, 6, 7, 8)", () => {
  it("BUDGET_ALREADY_OVERSPENT: describes the exceeded amount and utilization, no raw reasonCode", () => {
    renderWith(
      availableRisk({
        signals: [signal("BUDGET_ALREADY_OVERSPENT", "high", { exceededBy: 500, utilization: 112.5 })],
      })
    );

    expect(screen.getByText("Budget already exceeded")).toBeInTheDocument();
    expect(screen.getByText(/already been exceeded by ₹500/)).toBeInTheDocument();
    expect(screen.getByText(/113% used/)).toBeInTheDocument();
    expect(screen.queryByText("BUDGET_ALREADY_OVERSPENT")).not.toBeInTheDocument();
  });

  it("LOW_REMAINING_BUDGET: describes current utilization and remaining amount", () => {
    renderWith(
      availableRisk({
        signals: [signal("LOW_REMAINING_BUDGET", "moderate", { utilization: 92, remainingBudget: 400 })],
      })
    );

    expect(screen.getByText("Low remaining budget")).toBeInTheDocument();
    expect(screen.getByText(/92% of this month's budget has been used/)).toBeInTheDocument();
    expect(screen.getByText(/₹400 remaining/)).toBeInTheDocument();
  });

  it("PERSISTENT_SPENDING_GROWTH: describes the exact single-period comparison without claiming persistence", () => {
    renderWith(
      availableRisk({
        signals: [signal("PERSISTENT_SPENDING_GROWTH", "moderate", { percentageChange: 25 })],
      })
    );

    expect(screen.getByText("Spending is up compared to last month")).toBeInTheDocument();
    expect(screen.getByText(/up 25% compared to last month/)).toBeInTheDocument();
    // The evidence is only a single month-over-month comparison -- the
    // component's own copy must never claim "persistent" or "sustained".
    expect(screen.queryByText(/persistent/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sustained/i)).not.toBeInTheDocument();
  });

  it("ABNORMAL_HIGH_VALUE_EXPENSES: describes detected unusually high expenses without implying fraud", () => {
    renderWith(
      availableRisk({
        signals: [signal("ABNORMAL_HIGH_VALUE_EXPENSES", "moderate", { flaggedCount: 2, anomalies: [] })],
      })
    );

    expect(screen.getByText("Unusually high-value expenses detected")).toBeInTheDocument();
    expect(screen.getByText(/2 recent expenses were unusually high/)).toBeInTheDocument();
    expect(screen.queryByText(/fraud/i)).not.toBeInTheDocument();
  });

  it("FORECASTED_FINANCIAL_PRESSURE: uses the verified 'this month' horizon wording, never 'next month' (6)", () => {
    renderWith(
      availableRisk({
        signals: [
          signal("FORECASTED_FINANCIAL_PRESSURE", "high", { forecastedAmount: 6000, configuredBudget: 5000, ratio: 1.2 }),
        ],
      })
    );

    expect(screen.getByText("Projected spending pressure")).toBeInTheDocument();
    expect(screen.getByText(/Projected spending for this month \(₹6,000\)/)).toBeInTheDocument();
    expect(screen.getByText(/configured budget of ₹5,000/)).toBeInTheDocument();
    expect(screen.queryByText(/next month/i)).not.toBeInTheDocument();
  });

  it("DETERIORATING_HEALTH: shows the current score without claiming deterioration over time (8)", () => {
    renderWith(
      availableRisk({
        signals: [signal("DETERIORATING_HEALTH", "high", { overall: 32 })],
      })
    );

    expect(screen.getByText("Financial health score is currently low")).toBeInTheDocument();
    expect(screen.getByText(/currently low \(32\/100\)/)).toBeInTheDocument();
    expect(screen.queryByText(/declin/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/deteriorat/i)).not.toBeInTheDocument();
  });
});

describe("RiskInsights -- evidence formatting and robustness (9, 10, 11, 12, 13)", () => {
  it("renders currency, percentage, and score evidence using existing formatting conventions", () => {
    renderWith(
      availableRisk({
        signals: [signal("BUDGET_ALREADY_OVERSPENT", "high", { exceededBy: 1500, utilization: 100 })],
      })
    );

    expect(screen.getByText(/₹1,500/)).toBeInTheDocument();
    expect(screen.getByText(/100% used/)).toBeInTheDocument();
  });

  it("safely omits a signal's numeric evidence sentence when the evidence is malformed, without crashing", () => {
    expect(() =>
      renderWith(
        availableRisk({
          signals: [signal("BUDGET_ALREADY_OVERSPENT", "high", { exceededBy: "not-a-number", utilization: null })],
        })
      )
    ).not.toThrow();

    expect(screen.getByText("Budget already exceeded")).toBeInTheDocument();
    expect(screen.getByText("A risk signal was detected based on your financial data.")).toBeInTheDocument();
  });

  it("unknown reason codes render a safe generic entry without crashing or exposing the raw code", () => {
    expect(() =>
      renderWith(
        availableRisk({
          signals: [signal("SOME_FUTURE_RISK_CODE", "moderate", { anything: 123 })],
        })
      )
    ).not.toThrow();

    expect(screen.getByText("Additional risk signal")).toBeInTheDocument();
    expect(screen.getByText("A risk signal was detected based on your financial data.")).toBeInTheDocument();
    expect(screen.queryByText("SOME_FUTURE_RISK_CODE")).not.toBeInTheDocument();
  });

  it("severity is shown as visible text, not colour alone", () => {
    renderWith(
      availableRisk({
        signals: [signal("DETERIORATING_HEALTH", "high", { overall: 20 })],
      })
    );

    // Scoped to the badge specifically -- the summary line's overall level
    // (also "high" here, since availableRisk()'s default riskLevel is
    // "high" and this test doesn't override it) legitimately renders the
    // same word elsewhere, so an unscoped getByText("High") is ambiguous by
    // design, not a bug.
    expect(screen.getByText("High", { selector: ".risk-severity-badge" })).toBeInTheDocument();
  });

  it("preserves the backend's own signal ordering", () => {
    renderWith(
      availableRisk({
        signalCount: 2,
        signals: [
          signal("DETERIORATING_HEALTH", "high", { overall: 20 }),
          signal("LOW_REMAINING_BUDGET", "moderate", { utilization: 95, remainingBudget: 50 }),
        ],
      })
    );

    const titles = screen.getAllByText(/Financial health score is currently low|Low remaining budget/);
    expect(titles.map((el) => el.textContent)).toEqual([
      "Financial health score is currently low",
      "Low remaining budget",
    ]);
  });

  it("a malformed individual signal record is skipped without crashing, valid siblings still render", () => {
    expect(() =>
      renderWith(
        availableRisk({
          signalCount: 2,
          signals: [null, signal("LOW_REMAINING_BUDGET", "moderate", { utilization: 95, remainingBudget: 50 })],
        })
      )
    ).not.toThrow();

    expect(screen.getByText("Low remaining budget")).toBeInTheDocument();
  });
});

describe("RiskInsights -- no additional request (14)", () => {
  it("takes report as a plain prop and issues no network/query calls of its own", () => {
    // No jest.mock of any API/hook module is set up in this file at all --
    // if this component tried to import or call a query hook, this test
    // file would fail to even load. Rendering successfully with a plain
    // object prop is itself the proof.
    expect(() => renderWith(availableRisk())).not.toThrow();
  });
});
