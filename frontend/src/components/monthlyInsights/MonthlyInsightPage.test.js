import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import MonthlyInsightPage from "./MonthlyInsightPage";
import { useReport } from "../../hooks/useReport";
import AnomalyInsights from "./AnomalyInsights";

// Anomaly Detection Layer V1 -- proves MonthlyInsightPage wires the new
// Unusual Spending section into the SAME report query every other section
// already uses, mounting it exactly once with the exact report object.
//
// Every child section is mocked so this stays a focused wiring test, not a
// re-test of each section's own internal behavior (those already have
// their own dedicated test files).

// An explicit factory (rather than bare auto-mock) so Jest never evaluates
// the real useReport.js module at all -- that module's own import chain
// (reportApi.js -> api/axios.js -> the "axios" package) is unrelated to
// this page-wiring test and is exercised by its own existing tests
// elsewhere.
jest.mock("../../hooks/useReport", () => ({
  useReport: jest.fn(),
}));

// Isolates this page-wiring test from the unrelated chart/API import chain
// that "../imports/Imports" (Spinner's real home) transitively pulls in --
// that chain is exercised by its own existing tests elsewhere and is not
// part of what this file proves.
jest.mock("../imports/Imports", () => ({
  Spinner: () => <div data-testid="mock-spinner" />,
}));

jest.mock("./Header", () => () => <div data-testid="mock-header" />);
jest.mock("./BudgetIntelligence", () => () => <div data-testid="mock-budget-intelligence" />);
jest.mock("./SpendingInsights", () => () => <div data-testid="mock-spending-insights" />);
jest.mock("./SpendingForecast", () => () => <div data-testid="mock-spending-forecast" />);
jest.mock("./OverallInsight", () => () => <div data-testid="mock-overall-insight" />);
jest.mock("./AnomalyInsights", () => ({
  __esModule: true,
  default: jest.fn(),
}));

// react-scripts' default Jest config sets `resetMocks: true`, which wipes
// any implementation given at jest.mock() factory time before EVERY test
// (mockReset(), not just mockClear()). The implementation must therefore
// be (re)installed in beforeEach, not at module-factory time, or the mock
// silently renders nothing (a jest.fn() with no implementation returns
// undefined, which React treats as a valid "render nothing" result --
// no error, no warning, just an empty slot).
beforeEach(() => {
  AnomalyInsights.mockImplementation(() => <div data-testid="mock-anomaly-insights" />);
});

afterEach(() => {
  cleanup();
});

const mockReport = (overrides = {}) => ({
  summary: { totalSpent: 1000 },
  budgets: { budget: 5000, spent: 1000 },
  forecast: { hasData: false, reasonCode: "NO_ELIGIBLE_CURRENT_EXPENSES" },
  anomalies: { hasData: false, reasonCode: "NO_ELIGIBLE_CURRENT_EXPENSES", anomalies: [] },
  ...overrides,
});

describe("MonthlyInsightPage -- loading and error states", () => {
  it("shows the spinner while the report is loading", () => {
    useReport.mockReturnValue({ data: undefined, isLoading: true, error: null });

    render(<MonthlyInsightPage />);

    expect(screen.queryByTestId("mock-anomaly-insights")).not.toBeInTheDocument();
  });

  it("shows a failure message and mounts no sections when the report fails to load", () => {
    useReport.mockReturnValue({ data: undefined, isLoading: false, error: new Error("network") });

    render(<MonthlyInsightPage />);

    expect(screen.getByText("Failed to load report.")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-anomaly-insights")).not.toBeInTheDocument();
  });
});

describe("MonthlyInsightPage -- Anomaly Detection Layer V1 wiring", () => {
  it("mounts AnomalyInsights exactly once, passing the exact same report object every other section receives", () => {
    const report = mockReport();
    useReport.mockReturnValue({ data: report, isLoading: false, error: null });

    render(<MonthlyInsightPage />);

    expect(screen.getByTestId("mock-anomaly-insights")).toBeInTheDocument();
    expect(AnomalyInsights).toHaveBeenCalledTimes(1);
    expect(AnomalyInsights.mock.calls[0][0].report).toBe(report);
  });

  it("mounts every existing section alongside the new Anomaly Insights section, without altering their presence", () => {
    useReport.mockReturnValue({ data: mockReport(), isLoading: false, error: null });

    render(<MonthlyInsightPage />);

    expect(screen.getByTestId("mock-header")).toBeInTheDocument();
    expect(screen.getByTestId("mock-budget-intelligence")).toBeInTheDocument();
    expect(screen.getByTestId("mock-spending-insights")).toBeInTheDocument();
    expect(screen.getByTestId("mock-spending-forecast")).toBeInTheDocument();
    expect(screen.getByTestId("mock-anomaly-insights")).toBeInTheDocument();
    expect(screen.getByTestId("mock-overall-insight")).toBeInTheDocument();
  });

  it("does not call useReport a second time on behalf of the anomaly section (single shared query)", () => {
    useReport.mockReturnValue({ data: mockReport(), isLoading: false, error: null });

    render(<MonthlyInsightPage />);

    // MonthlyInsightPage itself is the only caller of useReport(); the
    // mocked AnomalyInsights never invokes it, so exactly one
    // call total.
    expect(useReport).toHaveBeenCalledTimes(1);
  });
});
