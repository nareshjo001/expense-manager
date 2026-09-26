// EXP-002-T05 -- proves ExpensesPage actually wires its new filter bar
// into the custom-range infinite query: the bar only appears in custom
// mode, every field change reaches useInfiniteExpensesQuery as a properly
// typed/trimmed 4th argument (never the raw controlled-input strings),
// removing one chip clears only that field, "Clear filters" resets all of
// them, and switching away from custom mode resets the filters for next
// time -- same reset discipline the existing startDate/endDate already
// have. ExpensesPage.test.js/.customInfiniteScroll.test.js/.errorState
// .test.js already cover the rest of this component; this file is
// dedicated to the new filter wiring only.
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

// BUD-001-T05 -- CategoryBudgets has its own suite (budget/CategoryBudgets.test.js)
// and needs a QueryClientProvider; not under test here.
jest.mock("./budget/CategoryBudgets", () => () => null);

// EXP-002-T06 -- ExpensesPage now reads/writes the URL via useSearchParams.
// Mocked wholesale (this codebase's established pattern for
// react-router-dom -- see AddExpense.test.js/App.startup.test.js) rather
// than wrapping in a real Router: these tests don't exercise URL
// persistence, so an empty, inert pair keeps existing behavior unchanged.
// See ExpensesPage.urlState.test.js for the dedicated URL-sync tests.
jest.mock("react-router-dom", () => ({
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
}), { virtual: true });

const inertInfiniteQueryResult = {
  data: undefined,
  isLoading: false,
  isError: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: jest.fn(),
  refetch: jest.fn(),
};

function enterCustomMode(startDate = "2026-01-01", endDate = "2026-01-31") {
  fireEvent.change(screen.getByDisplayValue("Filter By"), { target: { value: "custom" } });
  const dateInputs = document.querySelectorAll('input[type="date"]');
  fireEvent.change(dateInputs[0], { target: { value: startDate } });
  fireEvent.change(dateInputs[1], { target: { value: endDate } });
}

// Reads the searchFilters object (the 4th call arg) from the most recent
// useInfiniteExpensesQuery invocation.
function lastSearchFiltersArg() {
  const calls = useInfiniteExpensesQuery.mock.calls;
  return calls[calls.length - 1][3];
}

describe("ExpensesPage -- EXP-002-T05 filter bar wiring", () => {
  beforeEach(() => {
    useInfiniteExpensesQuery.mockReturnValue(inertInfiniteQueryResult);
    useExpenseInsights.mockReturnValue({
      notifyInitialLoad: jest.fn(),
      notifyFilterApplied: jest.fn(),
      clearExpenseInsights: jest.fn(),
      insightText: [],
      isInsightReady: false,
    });
    useExpensesQuery.mockReturnValue({ data: undefined, isLoading: false, isError: false, dataUpdatedAt: 0, refetch: jest.fn() });
  });

  afterEach(() => {
    cleanup();
    useInfiniteExpensesQuery.mockClear();
  });

  it("does not render the filter bar outside custom mode", () => {
    render(<ExpensesPage onDelete={jest.fn()} setIsEdit={jest.fn()} />);

    expect(screen.queryByRole("search", { name: "Filter expenses" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Filter By"), { target: { value: "bycategory" } });
    expect(screen.queryByRole("search", { name: "Filter expenses" })).not.toBeInTheDocument();
  });

  it("renders the filter bar once a full custom date range is chosen, and calls the query with all filters undefined by default", () => {
    render(<ExpensesPage onDelete={jest.fn()} setIsEdit={jest.fn()} />);
    enterCustomMode();

    expect(screen.getByRole("search", { name: "Filter expenses" })).toBeInTheDocument();
    expect(lastSearchFiltersArg()).toEqual({
      nameContains: undefined,
      category: undefined,
      minAmount: undefined,
      maxAmount: undefined,
      isRecurring: undefined,
    });
  });

  it("trims text filters and passes them through only once non-empty", () => {
    render(<ExpensesPage onDelete={jest.fn()} setIsEdit={jest.fn()} />);
    enterCustomMode();

    fireEvent.change(screen.getByLabelText("Search by expense name"), { target: { value: "  coffee  " } });
    expect(lastSearchFiltersArg().nameContains).toBe("coffee");

    fireEvent.change(screen.getByLabelText("Filter by category"), { target: { value: "Groceries" } });
    expect(lastSearchFiltersArg()).toMatchObject({ nameContains: "coffee", category: "Groceries" });
  });

  it("converts amount fields to numbers and isRecurring to a real boolean, never strings", () => {
    render(<ExpensesPage onDelete={jest.fn()} setIsEdit={jest.fn()} />);
    enterCustomMode();

    fireEvent.change(screen.getByLabelText("Minimum amount"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Maximum amount"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Filter by recurring status"), { target: { value: "false" } });

    const applied = lastSearchFiltersArg();
    expect(applied.minAmount).toBe(10);
    expect(applied.maxAmount).toBe(100);
    expect(applied.isRecurring).toBe(false);
  });

  it("removing one active-filter chip clears only that field", () => {
    render(<ExpensesPage onDelete={jest.fn()} setIsEdit={jest.fn()} />);
    enterCustomMode();

    fireEvent.change(screen.getByLabelText("Search by expense name"), { target: { value: "coffee" } });
    fireEvent.change(screen.getByLabelText("Minimum amount"), { target: { value: "10" } });

    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Name: coffee" }));

    const applied = lastSearchFiltersArg();
    expect(applied.nameContains).toBeUndefined();
    expect(applied.minAmount).toBe(10);
  });

  it("'Clear filters' resets every field back to undefined", () => {
    render(<ExpensesPage onDelete={jest.fn()} setIsEdit={jest.fn()} />);
    enterCustomMode();

    fireEvent.change(screen.getByLabelText("Search by expense name"), { target: { value: "coffee" } });
    fireEvent.change(screen.getByLabelText("Minimum amount"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(lastSearchFiltersArg()).toEqual({
      nameContains: undefined,
      category: undefined,
      minAmount: undefined,
      maxAmount: undefined,
      isRecurring: undefined,
    });
  });

  it("resets the search filters when the filter mode changes away from custom and back", () => {
    render(<ExpensesPage onDelete={jest.fn()} setIsEdit={jest.fn()} />);

    // Keep one stable reference to the Filter-By select: once its value is
    // "custom", getByDisplayValue("Filter By") no longer matches it (the
    // selected option's own label changes), so re-querying by that display
    // value after the first switch would fail.
    const filterSelect = screen.getByDisplayValue("Filter By");

    fireEvent.change(filterSelect, { target: { value: "custom" } });
    let dateInputs = document.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: "2026-01-01" } });
    fireEvent.change(dateInputs[1], { target: { value: "2026-01-31" } });

    fireEvent.change(screen.getByLabelText("Search by expense name"), { target: { value: "coffee" } });
    expect(lastSearchFiltersArg().nameContains).toBe("coffee");

    // Leave custom mode entirely, then come back with a fresh range.
    fireEvent.change(filterSelect, { target: { value: "" } });
    fireEvent.change(filterSelect, { target: { value: "custom" } });
    dateInputs = document.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: "2026-02-01" } });
    fireEvent.change(dateInputs[1], { target: { value: "2026-02-28" } });

    expect(screen.queryByText("Name: coffee")).not.toBeInTheDocument();
    expect(lastSearchFiltersArg().nameContains).toBeUndefined();
  });
});
