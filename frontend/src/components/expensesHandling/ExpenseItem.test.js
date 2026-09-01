// Recurring-State Authority and Crash-Recovery Remediation -- frontend contract.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import ExpenseItem from "./ExpenseItem";
import { useUpdateRecurringMutation } from "../../hooks/mutations/useUpdateRecurringMutation";
import { signUpSuccessToast, signUpErrorToast } from "../alertsEffects/toastMessages";

jest.mock("../../hooks/mutations/useUpdateRecurringMutation", () => ({
  useUpdateRecurringMutation: jest.fn(),
}));
jest.mock("../alertsEffects/toastMessages", () => ({
  signUpSuccessToast: jest.fn(),
  signUpErrorToast: jest.fn(),
}));

// Fully hand-mocked, same rationale as AddExpense.test.js: ExpenseItem.js
const mockNavigate = jest.fn();
jest.mock(
  "react-router-dom",
  () => ({
    useNavigate: () => mockNavigate,
  }),
  { virtual: true }
);

const baseExpense = {
  _id: "exp-1",
  expenseName: "Netflix",
  expenseCategory: "Entertainment",
  expenseAmount: 15,
  expenseDescription: "Monthly sub",
  expenseDate: "2026-08-01T00:00:00.000Z",
  isRecurring: false,
};

function setupMutation() {
  const mutate = jest.fn();
  useUpdateRecurringMutation.mockReturnValue({ mutate });
  return mutate;
}

afterEach(() => {
  jest.clearAllMocks();
});

describe("ExpenseItem -- recurring toggle label reflects authoritative isRecurring", () => {
  it('shows "Mark recurring" when expense.isRecurring is false', () => {
    setupMutation();
    render(<ExpenseItem expense={baseExpense} onDelete={jest.fn()} setIsEdit={jest.fn()} />);

    expect(screen.getByTitle("Mark recurring")).toBeInTheDocument();
  });

  it('shows "Unmark recurring" when expense.isRecurring is true', () => {
    setupMutation();
    render(<ExpenseItem expense={{ ...baseExpense, isRecurring: true }} onDelete={jest.fn()} setIsEdit={jest.fn()} />);

    expect(screen.getByTitle("Unmark recurring")).toBeInTheDocument();
  });
});

describe("ExpenseItem -- handleRecurring sends the exact desired-state payload", () => {
  it("sends { expenseId, isRecurring: true } when toggling an unmarked expense", () => {
    const mutate = setupMutation();
    render(<ExpenseItem expense={baseExpense} onDelete={jest.fn()} setIsEdit={jest.fn()} />);

    fireEvent.click(screen.getByTitle("Mark recurring"));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({ expenseId: "exp-1", isRecurring: true });
  });

  it("sends { expenseId, isRecurring: false } when toggling an already-marked expense", () => {
    const mutate = setupMutation();
    render(<ExpenseItem expense={{ ...baseExpense, isRecurring: true }} onDelete={jest.fn()} setIsEdit={jest.fn()} />);

    fireEvent.click(screen.getByTitle("Unmark recurring"));

    expect(mutate.mock.calls[0][0]).toEqual({ expenseId: "exp-1", isRecurring: false });
  });
});

describe("ExpenseItem -- recurring toggle result handling", () => {
  it("toasts success on a successful response", () => {
    const mutate = setupMutation();
    render(<ExpenseItem expense={baseExpense} onDelete={jest.fn()} setIsEdit={jest.fn()} />);

    fireEvent.click(screen.getByTitle("Mark recurring"));
    const { onSuccess } = mutate.mock.calls[0][1];
    const responseData = { success: true, message: "Recurring enabled", isRecurring: true };
    onSuccess(responseData);

    expect(signUpSuccessToast).toHaveBeenCalledWith(responseData);
  });

  it.each([401, 429, 409])("does not toast a second time for a %d error (already surfaced by the axios interceptor)", (status) => {
    const mutate = setupMutation();
    render(<ExpenseItem expense={baseExpense} onDelete={jest.fn()} setIsEdit={jest.fn()} />);

    fireEvent.click(screen.getByTitle("Mark recurring"));
    const { onError } = mutate.mock.calls[0][1];
    onError({ response: { status, data: { message: "should not surface" } } });

    expect(signUpErrorToast).not.toHaveBeenCalled();
  });

  it("toasts the error payload for any other error status (e.g. 404 non-disclosing not-found)", () => {
    const mutate = setupMutation();
    render(<ExpenseItem expense={baseExpense} onDelete={jest.fn()} setIsEdit={jest.fn()} />);

    fireEvent.click(screen.getByTitle("Mark recurring"));
    const { onError } = mutate.mock.calls[0][1];
    const errorData = { success: false, message: "Expense not found" };
    onError({ response: { status: 404, data: errorData } });

    expect(signUpErrorToast).toHaveBeenCalledWith(errorData);
  });
});

describe("ExpenseItem -- controlled mobile menu actions", () => {
  it("closes the open menu before deleting an expense", () => {
    setupMutation();
    const onDelete = jest.fn();
    const onCloseMobileMenu = jest.fn();
    render(
      <ExpenseItem
        expense={baseExpense}
        onDelete={onDelete}
        setIsEdit={jest.fn()}
        isMobileMenuOpen
        onToggleMobileMenu={jest.fn()}
        onCloseMobileMenu={onCloseMobileMenu}
      />
    );

    fireEvent.click(screen.getByText("Delete"));

    expect(onCloseMobileMenu).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("exp-1");
  });
});
