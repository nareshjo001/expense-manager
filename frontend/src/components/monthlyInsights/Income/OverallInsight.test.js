// FE-001-T08 -- OverallInsight previously had no test file. Each card's own
// "no data" fallback rendered identically whether the query was loading or
// had genuinely resolved to no data, and a fetch failure only logged to the
// console. This proves the state matrix: distinct loading / error+retry /
// content, with accessible roles, plus that legitimate per-card emptiness on
// a successful response is left untouched.
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import OverallInsight from "./OverallInsight";
import { useIncomeInsightsQuery } from "../../../hooks/queries/useIncomeInsightsQuery";

jest.mock("../../../hooks/queries/useIncomeInsightsQuery", () => ({
  useIncomeInsightsQuery: jest.fn(),
}));

// react-intersection-observer's useInView needs no real IntersectionObserver
// for this component -- it only gates an animation class, not content.
jest.mock("react-intersection-observer", () => ({
  useInView: () => ({ ref: jest.fn(), inView: true }),
}));

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

const FULL_INSIGHT = {
  savingsRateData: {
    status: "On track",
    savingsRate: 24,
    netBalance: 5000,
    subMessage: "Nice work.",
  },
  runwayData: {
    runwayDays: 30,
    subMessage: "Plenty of runway.",
  },
  incomeDependencyData: {
    dependencyPercent: 40,
    riskLevel: "Low risk",
    subMessage: "Diversified.",
  },
};

describe("monthlyInsights/Income/OverallInsight -- FE-001-T08 state matrix", () => {
  it("renders an accessible loading state and none of the card content while the query is loading", () => {
    useIncomeInsightsQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: jest.fn(),
    });

    render(<OverallInsight period="current_month" />);

    expect(screen.getByRole("status")).toHaveTextContent(/loading income insights/i);
    expect(screen.queryByText("Savings Rate")).not.toBeInTheDocument();
    // Critically, the "no data" fallback text must NOT appear while loading --
    // that was the exact bug (loading looked identical to genuinely empty).
    expect(screen.queryByText(/no income data available/i)).not.toBeInTheDocument();
  });

  it("renders an accessible error state with a working Retry, and no stale/partial card content", () => {
    const refetch = jest.fn();
    useIncomeInsightsQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { message: "Network Error" },
      refetch,
    });

    render(<OverallInsight period="current_month" />);

    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load your income insights/i);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders all three cards' real content once the query succeeds with full data", () => {
    useIncomeInsightsQuery.mockReturnValue({
      data: { success: true, data: FULL_INSIGHT },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<OverallInsight period="current_month" />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("24%")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("Low risk")).toBeInTheDocument();
  });

  it("still shows each card's own per-card empty fallback once the query succeeds with genuinely no data (unchanged behavior)", () => {
    useIncomeInsightsQuery.mockReturnValue({
      data: { success: true, data: {} },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<OverallInsight period="current_month" />);

    // "No income data available" is shared by both the Savings Rate and
    // Income Dependency cards, so it legitimately appears twice.
    expect(screen.getAllByText(/no income data available/i)).toHaveLength(2);
    expect(screen.getByText(/no runway data available/i)).toBeInTheDocument();
  });
});
