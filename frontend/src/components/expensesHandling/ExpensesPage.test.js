import React from "react";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import ExpensesPage from "./ExpensesPage";
import { useExpensesQuery } from "../../hooks/queries/useExpensesQuery";
import { useExpenseInsights } from "../contexts/ai-contexts/ExpenseInsightsContext";

jest.mock("framer-motion", () => ({
  motion: { p: ({ children }) => <p>{children}</p> },
}));

jest.mock("../imports/expensesImport", () => ({
  ExpenseItem: ({ expense, isMobileMenuOpen, onToggleMobileMenu }) => (
    <button
      className="mobile-menu-btn"
      data-testid={`expense-menu-${expense._id}`}
      data-open={String(Boolean(isMobileMenuOpen))}
      onClick={onToggleMobileMenu}
    >
      {expense.expenseName}
    </button>
  ),
  SetBudget: () => <div />,
  formatDateRange: () => "Custom range",
}));

jest.mock("../../hooks/queries/useExpensesQuery", () => ({
  useExpensesQuery: jest.fn(),
}));

jest.mock("../contexts/ai-contexts/ExpenseInsightsContext", () => ({
  useExpenseInsights: jest.fn(),
}));

jest.mock("../insights/InlineExpenseInsight", () => () => null);

const makeExpense = (index) => ({
  _id: `expense-${index}`,
  expenseName: `Expense ${index}`,
  expenseAmount: index,
});

describe("ExpensesPage progressive rendering", () => {
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
  });

  afterEach(() => {
    cleanup();
    delete window.IntersectionObserver;
  });

  it("renders the first batch and appends the next batch before the user reaches the list end", () => {
    const expenses = Array.from({ length: 32 }, (_, index) => makeExpense(index + 1));
    useExpensesQuery.mockReturnValue({
      data: { success: true, data: expenses, previousData: [], weeklyData: [] },
      isLoading: false,
      dataUpdatedAt: 1,
    });

    render(<ExpensesPage onDelete={jest.fn()} setIsEdit={jest.fn()} />);

    expect(screen.getByText("Expense 30")).toBeInTheDocument();
    expect(screen.queryByText("Expense 31")).not.toBeInTheDocument();
    expect(screen.getByText("Loading more expenses…")).toBeInTheDocument();

    act(() => {
      observerCallback([{ isIntersecting: true }]);
    });

    expect(screen.getByText("Expense 31")).toBeInTheDocument();
    expect(screen.getByText("Expense 32")).toBeInTheDocument();
    expect(screen.queryByText("Loading more expenses…")).not.toBeInTheDocument();
  });

  it("keeps one mobile expense menu open and dismisses it when the screen is touched elsewhere", () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });

    const expenses = [makeExpense(1), makeExpense(2)];
    useExpensesQuery.mockReturnValue({
      data: { success: true, data: expenses, previousData: [], weeklyData: [] },
      isLoading: false,
      dataUpdatedAt: 1,
    });

    render(<ExpensesPage onDelete={jest.fn()} setIsEdit={jest.fn()} />);

    const firstMenu = screen.getByTestId("expense-menu-expense-1");
    const secondMenu = screen.getByTestId("expense-menu-expense-2");

    fireEvent.click(firstMenu);
    expect(firstMenu).toHaveAttribute("data-open", "true");
    expect(document.body).toHaveClass("mobile-expense-menu-open");

    fireEvent.click(secondMenu);
    expect(firstMenu).toHaveAttribute("data-open", "false");
    expect(secondMenu).toHaveAttribute("data-open", "true");

    fireEvent.pointerDown(document.body);
    expect(secondMenu).toHaveAttribute("data-open", "false");
    expect(document.body).not.toHaveClass("mobile-expense-menu-open");

    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
  });
});
