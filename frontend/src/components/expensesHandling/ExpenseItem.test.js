// Recurring-State Authority and Crash-Recovery Remediation -- frontend contract.
//
// Covers ExpenseItem.js's recurring toggle: button label/title reflects the
// authoritative expense.isRecurring (now server-derived via
// annotateRecurringState, not a stale mirror), handleRecurring always sends
// the exact { expenseId, isRecurring: !isRecurring } desired-state payload,
// a successful response toasts success, and 401/429/409 errors are
// deliberately NOT re-toasted (already surfaced by the shared axios
// interceptor) while other errors are.
//
// useUpdateRecurringMutation is mocked directly (its own cache-reconciliation
// contract is covered separately in
// src/hooks/mutations/useUpdateRecurringMutation.test.js) so every mutation
// outcome here is driven by manually invoking the exact onSuccess/onError
// callbacks ExpenseItem.js passed to mutate().
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
// only calls useNavigate(), and this project's Jest setup cannot resolve the
// real react-router-dom v7 package.
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
