import { fireEvent, render, screen } from "@testing-library/react";
import Add from "./Add";

// The toggle only switches which form is shown; the forms themselves are
// covered by their own tests.
jest.mock("./AddExpense", () => () => <div data-testid="add-expense-view" />);
jest.mock("./AddIncome", () => () => <div data-testid="add-income-view" />);

describe("Add -- Add Expense / Add Income toggle", () => {
  it("starts on Add Expense and marks that half as pressed", () => {
    render(<Add isEdit={{ enableEdit: false }} setIsEdit={jest.fn()} />);

    expect(screen.getByTestId("add-expense-view")).toBeInTheDocument();
    expect(screen.queryByTestId("add-income-view")).toBeNull();
    expect(screen.getByRole("button", { name: "Add Expense" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Add Income" })).toHaveAttribute("aria-pressed", "false");
  });

  it("switches to Add Income and back, moving the active pill", () => {
    const { container } = render(<Add isEdit={{ enableEdit: false }} setIsEdit={jest.fn()} />);
    const slider = container.querySelector(".form-toggle-slider");

    fireEvent.click(screen.getByRole("button", { name: "Add Income" }));
    expect(screen.getByTestId("add-income-view")).toBeInTheDocument();
    expect(screen.queryByTestId("add-expense-view")).toBeNull();
    expect(screen.getByRole("button", { name: "Add Income" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Add Income" })).toHaveClass("active");
    expect(slider).toHaveClass("right");

    fireEvent.click(screen.getByRole("button", { name: "Add Expense" }));
    expect(screen.getByTestId("add-expense-view")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Expense" })).toHaveAttribute("aria-pressed", "true");
    expect(slider).not.toHaveClass("right");
  });
});
