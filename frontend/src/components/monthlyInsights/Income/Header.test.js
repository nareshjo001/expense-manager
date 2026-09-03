// FE-001-T08 -- Header previously had no test file. DEFAULT_CARD_DATA's
// zeroed totals fed the exact same "insufficient data" copy used for a
// genuinely empty response, so loading and empty were visually identical,
// and a fetch failure was toast-only with nothing persistent shown. This
// proves the state matrix: distinct loading / error+retry / content.
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import Header from "./Header";
import { useIncomeSummaryQuery } from "../../../hooks/queries/useIncomeSummaryQuery";

jest.mock("../../../hooks/queries/useIncomeSummaryQuery", () => ({
  useIncomeSummaryQuery: jest.fn(),
}));

// IncomeModal is unconditionally mounted by Header (controlled by
// showIncomeModal); mocked here since its own query behavior is covered by
// IncomeModal.test.js.
jest.mock("../../IncomeHandling/IncomeModal", () => () => <div data-testid="mock-income-modal" />);

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

const FULL_CARD_DATA = {
  totalIncome: 12000,
  totalExpenses: 4000,
  totalIncomes: 3,
  balance: 8000,
  topSource: "Salary",
};

describe("monthlyInsights/Income/Header -- FE-001-T08 state matrix", () => {
  it("renders accessible loading states for both the total-income box and the card grid, with none of the real content", () => {
    useIncomeSummaryQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: jest.fn(),
    });

    render(<Header period="current_month" setPeriod={jest.fn()} />);

    const statuses = screen.getAllByRole("status");
    expect(statuses.some((el) => /loading/i.test(el.textContent))).toBe(true);
    expect(screen.queryByText("Total Income")).not.toBeInTheDocument();
    expect(screen.queryByText("Net Balance")).not.toBeInTheDocument();
    // Critically, the zero-fallback copy must NOT appear while loading --
    // that was the exact bug (loading looked identical to genuinely empty).
    expect(screen.queryByText(/no balance available/i)).not.toBeInTheDocument();
  });

  it("renders an accessible error state in the card grid with a working Retry", () => {
    const refetch = jest.fn();
    useIncomeSummaryQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { message: "Network Error" },
      refetch,
    });

    render(<Header period="current_month" setPeriod={jest.fn()} />);

    // Both the compact total-income box and the card grid show their own
    // error copy -- only the card grid carries the Retry action.
    const alerts = screen.getAllByRole("alert");
    expect(alerts.some((el) => /couldn't load your income insights/i.test(el.textContent))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("renders the real totals and all three cards once the query succeeds", () => {
    useIncomeSummaryQuery.mockReturnValue({
      data: { data: FULL_CARD_DATA },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<Header period="current_month" setPeriod={jest.fn()} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Total Income")).toBeInTheDocument();
    expect(screen.getByText("Net Balance")).toBeInTheDocument();
    expect(screen.getByText("Salary")).toBeInTheDocument();
  });

  it("still shows the zero/N/A fallback copy once the query succeeds with genuinely empty data (unchanged behavior)", () => {
    useIncomeSummaryQuery.mockReturnValue({
      data: { data: { totalIncome: 0, totalExpenses: 0, totalIncomes: 0, balance: 0, topSource: "N/A" } },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<Header period="current_month" setPeriod={jest.fn()} />);

    expect(screen.getByText(/no balance available/i)).toBeInTheDocument();
    expect(screen.getByText(/no income records/i)).toBeInTheDocument();
    expect(screen.getByText(/no income sources/i)).toBeInTheDocument();
  });
});
