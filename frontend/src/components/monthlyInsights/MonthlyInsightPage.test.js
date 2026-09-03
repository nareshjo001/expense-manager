import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import MonthlyInsightPage from "./MonthlyInsightPage";
import { useReport } from "../../hooks/useReport";
import AnomalyInsights from "./AnomalyInsights";

// Anomaly Detection Layer V1 -- proves MonthlyInsightPage wires the new

// An explicit factory (rather than bare auto-mock) so Jest never evaluates
jest.mock("../../hooks/useReport", () => ({
  useReport: jest.fn(),
}));

// Isolates this page-wiring test from the unrelated chart/API import chain
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

describe("MonthlyInsightPage -- loading, error, empty and retry states (FE-001)", () => {
  it("shows an explicit loading message while the report is loading", () => {
    useReport.mockReturnValue({ data: undefined, isLoading: true, isError: false, refetch: jest.fn() });

    render(<MonthlyInsightPage />);

    expect(screen.getByText("Loading your monthly insights...")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-anomaly-insights")).not.toBeInTheDocument();
  });

  it("shows a distinct failure message with a retry action when the report fails to load", () => {
    const refetch = jest.fn();
    useReport.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });

    render(<MonthlyInsightPage />);

    expect(screen.getByText("We couldn't load your report. Please try again.")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-anomaly-insights")).not.toBeInTheDocument();

    screen.getByRole("button", { name: "Retry" }).click();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows a distinct empty-state message (not the error message) for a genuinely empty report", () => {
    useReport.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: jest.fn() });

    render(<MonthlyInsightPage />);

    expect(screen.getByText("No report data yet.")).toBeInTheDocument();
    expect(screen.queryByText("We couldn't load your report. Please try again.")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mock-anomaly-insights")).not.toBeInTheDocument();
  });
});

describe("MonthlyInsightPage -- Anomaly Detection Layer V1 wiring", () => {
  it("mounts AnomalyInsights exactly once, passing the exact same report object every other section receives", () => {
    const report = mockReport();
    useReport.mockReturnValue({ data: report, isLoading: false, isError: false, refetch: jest.fn() });

    render(<MonthlyInsightPage />);

    expect(screen.getByTestId("mock-anomaly-insights")).toBeInTheDocument();
    expect(AnomalyInsights).toHaveBeenCalledTimes(1);
    expect(AnomalyInsights.mock.calls[0][0].report).toBe(report);
  });

  it("mounts every existing section alongside the new Anomaly Insights section, without altering their presence", () => {
    useReport.mockReturnValue({ data: mockReport(), isLoading: false, isError: false, refetch: jest.fn() });

    render(<MonthlyInsightPage />);

    expect(screen.getByTestId("mock-header")).toBeInTheDocument();
    expect(screen.getByTestId("mock-budget-intelligence")).toBeInTheDocument();
    expect(screen.getByTestId("mock-spending-insights")).toBeInTheDocument();
    expect(screen.getByTestId("mock-spending-forecast")).toBeInTheDocument();
    expect(screen.getByTestId("mock-anomaly-insights")).toBeInTheDocument();
    expect(screen.getByTestId("mock-overall-insight")).toBeInTheDocument();
  });

  it("does not call useReport a second time on behalf of the anomaly section (single shared query)", () => {
    useReport.mockReturnValue({ data: mockReport(), isLoading: false, isError: false, refetch: jest.fn() });

    render(<MonthlyInsightPage />);

    // MonthlyInsightPage itself is the only caller of useReport(); the
    expect(useReport).toHaveBeenCalledTimes(1);
  });
});
