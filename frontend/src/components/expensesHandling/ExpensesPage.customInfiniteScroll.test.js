// EXP-003-T05 -- custom-date-range mode now drives its list from
// useInfiniteExpensesQuery (network-paged) instead of a single, fully-
// fetched array windowed client-side. ExpensesPage.test.js already covers
// the client-windowed (last-week) path; this file is dedicated to the
// infinite-query path only.
import React from "react";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import ExpensesPage from "./ExpensesPage";
import { useExpensesQuery } from "../../hooks/queries/useExpensesQuery";
import { useInfiniteExpensesQuery } from "../../hooks/queries/useInfiniteExpensesQuery";
import { useExpenseInsights } from "../contexts/ai-contexts/ExpenseInsightsContext";

jest.mock("framer-motion", () => ({
  motion: { p: ({ children }) => <p>{children}</p> },
}));

jest.mock("../imports/expensesImport", () => ({
  ExpenseItem: ({ expense }) => <div>{expense.expenseName}</div>,
  SetBudget: () => <div />,
  formatDateRange: (start, end) => `${start} to ${end}`,
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

const makeExpense = (id) => ({ _id: id, expenseName: `Expense ${id}`, expenseAmount: 10 });

function selectCustomRange(startDate = "2026-01-01", endDate = "2026-01-31") {
  fireEvent.change(screen.getByDisplayValue("Filter By"), { target: { value: "custom" } });
  const dateInputs = document.querySelectorAll('input[type="date"]');
  fireEvent.change(dateInputs[0], { target: { value: startDate } });
  fireEvent.change(dateInputs[1], { target: { value: endDate } });
}

describe("ExpensesPage -- custom-range infinite query", () => {
  let observerCallback;

  beforeEach(() => {
    observerCallback = null;
    window.IntersectionObserver = class {
      constructor(callback) {
        observerCallback = callback;
      }

      observe() {}
      disconnect() {}
    };

    useExpenseInsights.mockReturnValue({
      notifyInitialLoad: jest.fn(),
      notifyFilterApplied: jest.fn(),
      clearExpenseInsights: jest.fn(),
      insightText: [],
      isInsightReady: false,
    });

    // Never actually consulted in custom mode, but ExpensesPage always calls the hook (rules of hooks).
    useExpensesQuery.mockReturnValue({ data: undefined, isLoading: false, dataUpdatedAt: 0 });
  });

  afterEach(() => {
    cleanup();
    delete window.IntersectionObserver;
  });

  it("renders expenses flattened from every already-fetched page", () => {
    useInfiniteExpensesQuery.mockReturnValue({
      data: { pages: [{ success: true, data: [makeExpense(1), makeExpense(2)] }, { success: true, data: [makeExpense(3)] }] },
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: jest.fn(),
    });

    render(<ExpensesPage onDelete={jest.fn()} setIsEdit={jest.fn()} />);
    selectCustomRange();

    expect(screen.getByText("Expense 1")).toBeInTheDocument();
    expect(screen.getByText("Expense 2")).toBeInTheDocument();
    expect(screen.getByText("Expense 3")).toBeInTheDocument();
  });

  it("shows the loading state from the infinite query while in custom mode", () => {
    useInfiniteExpensesQuery.mockReturnValue({
      data: undefined,
      isLoading: true,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: jest.fn(),
    });

    render(<ExpensesPage onDelete={jest.fn()} setIsEdit={jest.fn()} />);
    selectCustomRange();

    expect(document.querySelector(".loading-dots")).toBeInTheDocument();
  });

  it("shows the load-more indicator only while the server reports another page exists, and fetches it once the sentinel intersects", () => {
    const fetchNextPage = jest.fn();
    useInfiniteExpensesQuery.mockReturnValue({
      data: { pages: [{ success: true, data: [makeExpense(1)] }] },
      isLoading: false,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage,
    });

    render(<ExpensesPage onDelete={jest.fn()} setIsEdit={jest.fn()} />);
    selectCustomRange();

    expect(screen.getByText("Loading more expenses…")).toBeInTheDocument();

    act(() => {
      observerCallback([{ isIntersecting: true }]);
    });

    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("never issues a second fetchNextPage call while one is already in flight", () => {
    const fetchNextPage = jest.fn();
    useInfiniteExpensesQuery.mockReturnValue({
      data: { pages: [{ success: true, data: [makeExpense(1)] }] },
      isLoading: false,
      hasNextPage: true,
      isFetchingNextPage: true,
      fetchNextPage,
    });

    render(<ExpensesPage onDelete={jest.fn()} setIsEdit={jest.fn()} />);
    selectCustomRange();

    act(() => {
      observerCallback([{ isIntersecting: true }]);
    });

    expect(fetchNextPage).not.toHaveBeenCalled();
  });

  it("hides the load-more indicator once the server reports no further pages", () => {
    useInfiniteExpensesQuery.mockReturnValue({
      data: { pages: [{ success: true, data: [makeExpense(1)] }] },
      isLoading: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: jest.fn(),
    });

    render(<ExpensesPage onDelete={jest.fn()} setIsEdit={jest.fn()} />);
    selectCustomRange();

    expect(screen.queryByText("Loading more expenses…")).not.toBeInTheDocument();
  });
});
