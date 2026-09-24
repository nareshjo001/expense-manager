// EXP-002-T05 -- unit tests for the filter bar + active-filter chips
// introduced for the custom-date-range expense search. This component is
// plain/dependency-free (no context, no query hooks), so it's tested as a
// pure controlled form: every field change hands the parent a full,
// merged `filters` object (never a partial patch), matching the contract
// ExpensesPage relies on (`onChange={setSearchFilters}`).
import React from "react";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import ExpenseFilterBar from "./ExpenseFilterBar";

afterEach(cleanup);

const emptyFilters = {
  nameContains: "",
  category: "",
  minAmount: "",
  maxAmount: "",
  isRecurring: "",
};

describe("ExpenseFilterBar -- controls", () => {
  it("renders no chips and no clear button when nothing is set", () => {
    render(<ExpenseFilterBar filters={emptyFilters} onChange={jest.fn()} onClear={jest.fn()} />);

    expect(screen.queryByRole("list", { name: "Active filters" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("hands the parent the full merged filters object on a name change, not a partial patch", () => {
    const onChange = jest.fn();
    render(<ExpenseFilterBar filters={emptyFilters} onChange={onChange} onClear={jest.fn()} />);

    fireEvent.change(screen.getByLabelText("Search by expense name"), { target: { value: "coffee" } });

    expect(onChange).toHaveBeenCalledWith({ ...emptyFilters, nameContains: "coffee" });
  });

  it("updates category, minAmount, maxAmount and isRecurring through the same merged-object contract", () => {
    const onChange = jest.fn();
    render(<ExpenseFilterBar filters={emptyFilters} onChange={onChange} onClear={jest.fn()} />);

    fireEvent.change(screen.getByLabelText("Filter by category"), { target: { value: "Groceries" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyFilters, category: "Groceries" });

    fireEvent.change(screen.getByLabelText("Minimum amount"), { target: { value: "10" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyFilters, minAmount: "10" });

    fireEvent.change(screen.getByLabelText("Maximum amount"), { target: { value: "100" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyFilters, maxAmount: "100" });

    fireEvent.change(screen.getByLabelText("Filter by recurring status"), { target: { value: "true" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...emptyFilters, isRecurring: "true" });
  });

  it("offers the third distinct 'Any' option for isRecurring, separate from an explicit false", () => {
    render(<ExpenseFilterBar filters={emptyFilters} onChange={jest.fn()} onClear={jest.fn()} />);

    const select = screen.getByLabelText("Filter by recurring status");
    const optionValues = Array.from(select.querySelectorAll("option")).map((o) => o.value);

    expect(optionValues).toEqual(["", "true", "false"]);
    expect(select.value).toBe("");
  });
});

describe("ExpenseFilterBar -- active chips", () => {
  const activeFilters = {
    nameContains: "coffee",
    category: "Groceries",
    minAmount: "10",
    maxAmount: "100",
    isRecurring: "true",
  };

  it("renders one chip per active filter, trimmed, and shows the clear-filters button", () => {
    render(<ExpenseFilterBar filters={activeFilters} onChange={jest.fn()} onClear={jest.fn()} />);

    const chipList = screen.getByRole("list", { name: "Active filters" });
    expect(chipList).toBeInTheDocument();
    // Scoped to the chip list -- "Recurring only"/"One-time only" are also
    // option labels in the always-present <select>, so an unscoped
    // getByText would be ambiguous.
    expect(within(chipList).getByText("Name: coffee")).toBeInTheDocument();
    expect(within(chipList).getByText("Category: Groceries")).toBeInTheDocument();
    expect(within(chipList).getByText("Min: 10")).toBeInTheDocument();
    expect(within(chipList).getByText("Max: 100")).toBeInTheDocument();
    expect(within(chipList).getByText("Recurring only")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("shows 'One-time only' (not 'Recurring only') when isRecurring is explicitly 'false'", () => {
    render(
      <ExpenseFilterBar
        filters={{ ...emptyFilters, isRecurring: "false" }}
        onChange={jest.fn()}
        onClear={jest.fn()}
      />
    );

    const chipList = screen.getByRole("list", { name: "Active filters" });
    expect(within(chipList).getByText("One-time only")).toBeInTheDocument();
    expect(within(chipList).queryByText("Recurring only")).not.toBeInTheDocument();
  });

  it("clears only the removed field's chip, leaving the rest of the filters object untouched", () => {
    const onChange = jest.fn();
    render(<ExpenseFilterBar filters={activeFilters} onChange={onChange} onClear={jest.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Category: Groceries" }));

    expect(onChange).toHaveBeenCalledWith({ ...activeFilters, category: "" });
  });

  it("calls onClear -- not onChange -- when 'Clear filters' is clicked", () => {
    const onChange = jest.fn();
    const onClear = jest.fn();
    render(<ExpenseFilterBar filters={activeFilters} onChange={onChange} onClear={onClear} />);

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("treats whitespace-only text fields as inactive -- no chip, no clear button", () => {
    render(
      <ExpenseFilterBar
        filters={{ ...emptyFilters, nameContains: "   " }}
        onChange={jest.fn()}
        onClear={jest.fn()}
      />
    );

    expect(screen.queryByRole("list", { name: "Active filters" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });
});
