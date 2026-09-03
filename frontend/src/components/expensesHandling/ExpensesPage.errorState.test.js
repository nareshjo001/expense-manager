// Improvements-#13/FE-001-T08 -- ExpensesPage previously had no distinct
// error state: a genuine fetch failure left `loading` false and
// `groupedExpenses` empty, which rendered identically to "No Expenses" on
// the app's main data screen. Proves the new error state is now shown
// instead, is distinct from both loading and genuinely-empty, and offers a
// working retry -- for both the default/category query and the custom-range
// infinite query.
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ExpensesPage from "./ExpensesPage";
import { useExpensesQuery } from "../../hooks/queries/useExpensesQuery";
import { useInfiniteExpensesQuery } from "../../hooks/queries/useInfiniteExpensesQuery";
import { useExpenseInsights } from "../contexts/ai-contexts/ExpenseInsightsContext";

jest.mock("framer-motion", () => ({
  motion: { p: ({ children }) => <p>{children}</p> },
}));

jest.mock("../imports/expensesImport", () => ({
  ExpenseItem: () => null,
  SetBudget: () => <div />,
  formatDateRange: () => "Custom range",
}));

jest.mock("../../hooks/queries/useExpensesQuery", () => ({
  useExpensesQuery: jest.fn(),
}));

jest.mock("../../hooks/queries/useInfiniteExpensesQuery", () => ({
  useInfiniteExpensesQuery: jest.fn(),
}));

jest.mock("../contexts/ai-contexts/ExpenseInsightsContext", () => ({
  useExpenseInsights: jest.fn(),
}));

jest.mock("../insights/InlineExpenseInsight", () => () => null);

const mockInsights = () => ({
  notifyInitialLoad: jest.fn(),
  notifyFilterApplied: jest.fn(),
  clearExpenseInsights: jest.fn(),
  insightText: [],
  isInsightReady: false,
});

afterEach(() => {
  cleanup();
});

describe("ExpensesPage -- explicit error state (default/category mode)", () => {
  beforeEach(() => {
    useExpenseInsights.mockReturnValue(mockInsights());
    useInfiniteExpensesQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: jest.fn(),
      refetch: jest.fn(),
    });
  });

  it("shows a distinct, retryable error state -- not the loading or empty state -- when the query fails", () => {
    const refetch = jest.fn();
    useExpensesQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      dataUpdatedAt: 0,
      refetch,
    });

    render(<ExpensesPage onDelete={jest.fn()} setIsEdit={jest.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load your expenses. Please try again.");
    expect(screen.queryByText("No Expenses")).not.toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("still shows the genuine empty state (not an error) when the query succeeds with no expenses", () => {
    useExpensesQuery.mockReturnValue({
      data: { success: true, data: [], previousData: [], weeklyData: [] },
      isLoading: false,
      isError: false,
      dataUpdatedAt: 1,
      refetch: jest.fn(),
    });

    render(<ExpensesPage onDelete={jest.fn()} setIsEdit={jest.fn()} />);

    expect(screen.getByText("No Expenses")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("prioritizes the loading state over the error state while a fetch is still in flight", () => {
    useExpensesQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: true,
      dataUpdatedAt: 0,
      refetch: jest.fn(),
    });

    const { container } = render(<ExpensesPage onDelete={jest.fn()} setIsEdit={jest.fn()} />);

    expect(container.querySelector(".loading-dots")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ExpensesPage -- explicit error state (custom-range infinite mode)", () => {
  beforeEach(() => {
    useExpenseInsights.mockReturnValue(mockInsights());
    useExpensesQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      dataUpdatedAt: 0,
      refetch: jest.fn(),
    });
  });

  it("shows the error state and retries the infinite query when the custom-range fetch fails", () => {
    const refetch = jest.fn();
    useInfiniteExpensesQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: jest.fn(),
      refetch,
    });

    const { container } = render(<ExpensesPage onDelete={jest.fn()} setIsEdit={jest.fn()} />);

    // Enter custom mode with a full date range so isCustomMode is true and
    // the infinite query (not the plain one) drives the error state.
    fireEvent.change(screen.getByDisplayValue("Filter By"), { target: { value: "custom" } });
    const dateInputs = container.querySelectorAll('input[type="date"]');
    expect(dateInputs).toHaveLength(2);
    fireEvent.change(dateInputs[0], { target: { value: "2026-01-01" } });
    fireEvent.change(dateInputs[1], { target: { value: "2026-01-31" } });

    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't load your expenses. Please try again.");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
