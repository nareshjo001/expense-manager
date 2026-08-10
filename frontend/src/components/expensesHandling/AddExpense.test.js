// Phase C -- Expense Mutation Reliability, Recovery, and Idempotency.
//
// Covers the AddExpense.js changes: a stable per-add-attempt idempotency id
// (survives rerenders/retries, only replaced on committed success or a
// genuinely new form session), and calm "still refreshing" messaging for a
// committed-but-pending response instead of the default success toast.
//
// useAddExpenseMutation/useUpdateExpenseMutation are mocked directly (their
// own Phase C compatibility is covered separately in
// src/hooks/mutations/expenseMutations.reliability.test.js) so every
// mutation outcome here is driven by manually invoking the exact
// onSuccess/onError callbacks AddExpense.js passed in -- deterministic,
// no real network, no timers.
import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import AddExpense from "./AddExpense";
import { useAddExpenseMutation } from "../../hooks/mutations/useAddExpenseMutation";
import { useUpdateExpenseMutation } from "../../hooks/mutations/useUpdateExpenseMutation";
import { expenseAddSuccessToast, expenseAddErrorToast } from "../alertsEffects/toastMessages";
import { queryClient } from "../../query/queryClient";

// Explicit factories (not bare jest.mock(path) auto-mocking) so Jest never
// needs to load-and-introspect the real hook modules -- those transitively
// import ../../api/axios, and this project's pinned axios version ships an
// ESM-only entry that CRA's bundled Jest transform config does not parse
// (a pre-existing, unrelated environment limitation).
jest.mock("../../hooks/mutations/useAddExpenseMutation", () => ({
  useAddExpenseMutation: jest.fn(),
}));
jest.mock("../../hooks/mutations/useUpdateExpenseMutation", () => ({
  useUpdateExpenseMutation: jest.fn(),
}));
jest.mock("../alertsEffects/toastMessages", () => ({
  expenseAddSuccessToast: jest.fn(),
  expenseAddErrorToast: jest.fn(),
}));
jest.mock("../billScanner/BillUpload", () => () => null);
jest.mock("../../api/expenseApi", () => ({
  getExpenseEditData: jest.fn(),
}));
jest.mock("../../query/queryClient", () => ({
  queryClient: { fetchQuery: jest.fn() },
}));

// CRA's default Jest config sets `resetMocks: true`, which wipes a
// jest.fn()'s implementation (including mockResolvedValue) before every
// single test -- so the resolved value must be (re-)installed in
// beforeEach, not at jest.mock() factory time, or every test after the
// first would see fetchQuery() resolve to undefined.
beforeEach(() => {
  queryClient.fetchQuery.mockResolvedValue({ data: null });
});

// Fully hand-mocked (no jest.requireActual, no Router wrapper needed) --
// AddExpense.js only calls useNavigate(), and the real react-router-dom v7
// package is not resolvable under this project's bundled CRA/Jest 27 setup
// (a pre-existing, unrelated environment limitation: react-router-dom v7's
// ESM-first "exports" map is not resolved by Jest 27's bundled resolver).
const mockNavigate = jest.fn();
jest.mock(
  "react-router-dom",
  () => ({
    useNavigate: () => mockNavigate,
  }),
  { virtual: true }
);

afterEach(() => {
  jest.clearAllMocks();
});

function fillRequiredFields({ name = "Tx" } = {}) {
  // "Tx" is deliberately under the ML-prediction debounce effect's 3-char
  // threshold (see AddExpense.js) so no debounced fetch is ever scheduled
  // -- keeps this suite fully synchronous and timer-free.
  fireEvent.change(screen.getByLabelText(/name of the expense/i), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Food" } });
  fireEvent.change(screen.getByLabelText(/amount spent/i), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText(/date spent/i), { target: { value: "2026-01-15" } });
}

function renderAddExpense(isEdit = { enableEdit: false, expense_id: "" }, setIsEdit = jest.fn()) {
  return render(<AddExpense isEdit={isEdit} setIsEdit={setIsEdit} />);
}

function submitAndCaptureCallbacks(mockMutate, callIndex = 0) {
  fireEvent.submit(document.querySelector("form.add-expense"));
  const [payload, callbacks] = mockMutate.mock.calls[callIndex];
  return { payload, callbacks };
}

describe("AddExpense -- stable add-attempt idempotency id", () => {
  let mockAddMutate;

  beforeEach(() => {
    mockAddMutate = jest.fn();
    useAddExpenseMutation.mockReturnValue({ mutate: mockAddMutate });
    useUpdateExpenseMutation.mockReturnValue({ mutate: jest.fn() });
  });

  it("reuses the same id across a retried submit while the form stays open (lost-response retry)", () => {
    renderAddExpense();
    fillRequiredFields();

    const first = submitAndCaptureCallbacks(mockAddMutate, 0);
    // Simulate a lost response: no callback fired yet, user retries.
    fireEvent.submit(document.querySelector("form.add-expense"));
    const second = mockAddMutate.mock.calls[1][0];

    expect(second.id).toBe(first.payload.id);
  });

  it("does not regenerate the id merely because the mutation function reference is re-derived on rerender", () => {
    const { rerender } = renderAddExpense();
    fillRequiredFields();
    const first = submitAndCaptureCallbacks(mockAddMutate, 0);

    // A new mutate function identity (as a fresh useMutation() call would
    // produce) must not change the in-flight attempt's id.
    const newMockMutate = jest.fn();
    useAddExpenseMutation.mockReturnValue({ mutate: newMockMutate });
    rerender(<AddExpense isEdit={{ enableEdit: false, expense_id: "" }} setIsEdit={jest.fn()} />);
    fireEvent.submit(document.querySelector("form.add-expense"));

    expect(newMockMutate.mock.calls[0][0].id).toBe(first.payload.id);
  });

  it("issues a NEW id for the next add after a committed success", () => {
    renderAddExpense();
    fillRequiredFields();
    const first = submitAndCaptureCallbacks(mockAddMutate, 0);

    act(() => {
      first.callbacks.onSuccess({
        success: true,
        message: "Expense Created Successfully",
        data: {},
        derivedData: { status: "synchronized", recoveryPending: false },
        replayed: false,
      });
    });

    fillRequiredFields({ name: "Ta" });
    fireEvent.submit(document.querySelector("form.add-expense"));
    const second = mockAddMutate.mock.calls[1][0];

    expect(second.id).not.toBe(first.payload.id);
  });

  it("clears the in-flight add-attempt id when entering edit mode (a genuinely new form session)", async () => {
    const { rerender } = renderAddExpense({ enableEdit: false, expense_id: "" }, jest.fn());
    fillRequiredFields();
    const first = submitAndCaptureCallbacks(mockAddMutate, 0);

    // Parent transitions into edit mode (e.g. user clicked "edit" on an
    // existing expense) -- the abandoned add attempt's id must not survive.
    // Awaits the real edit-load effect's fetchQuery() call to settle (its
    // resolved value is asserted deterministically, not timing-guessed)
    // before continuing, so no state update lands outside act().
    await act(async () => {
      rerender(<AddExpense isEdit={{ enableEdit: true, expense_id: "some-expense-id" }} setIsEdit={jest.fn()} />);
    });
    await waitFor(() => expect(queryClient.fetchQuery).toHaveBeenCalled());

    // Back to add mode for a new add.
    rerender(<AddExpense isEdit={{ enableEdit: false, expense_id: "" }} setIsEdit={jest.fn()} />);
    fillRequiredFields({ name: "Ta" });
    fireEvent.submit(document.querySelector("form.add-expense"));
    const second = mockAddMutate.mock.calls[1][0];

    expect(second.id).not.toBe(first.payload.id);
  });
});

describe("AddExpense -- committed success UX (synchronized vs pending)", () => {
  let mockAddMutate;

  beforeEach(() => {
    mockAddMutate = jest.fn();
    useAddExpenseMutation.mockReturnValue({ mutate: mockAddMutate });
    useUpdateExpenseMutation.mockReturnValue({ mutate: jest.fn() });
  });

  it("a synchronized 2xx follows the normal success path with the unmodified backend message", () => {
    renderAddExpense();
    fillRequiredFields();
    const { callbacks } = submitAndCaptureCallbacks(mockAddMutate, 0);

    act(() => {
      callbacks.onSuccess({
        success: true,
        message: "Expense Created Successfully",
        data: {},
        derivedData: { status: "synchronized", recoveryPending: false },
        replayed: false,
      });
    });

    expect(mockNavigate).toHaveBeenCalledWith("/");
    expect(expenseAddSuccessToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Expense Created Successfully" })
    );
    // Form was reset -- the name field is empty again.
    expect(screen.getByLabelText(/name of the expense/i).value).toBe("");
  });

  it("a committed-but-pending 2xx still follows the success path, with calm non-alarming wording", () => {
    renderAddExpense();
    fillRequiredFields();
    const { callbacks } = submitAndCaptureCallbacks(mockAddMutate, 0);

    act(() => {
      callbacks.onSuccess({
        success: true,
        message: "Expense Created Successfully",
        data: {},
        derivedData: { status: "pending", budget: "pending", report: "synchronized", recoveryPending: true },
        replayed: false,
      });
    });

    // Same success path: navigated home, form reset.
    expect(mockNavigate).toHaveBeenCalledWith("/");
    expect(screen.getByLabelText(/name of the expense/i).value).toBe("");

    const toastArg = expenseAddSuccessToast.mock.calls[0][0];
    expect(toastArg.message).toBe("Expense saved. Budget and insights are still refreshing.");
    expect(toastArg.message.toLowerCase()).not.toMatch(/fail|error|resubmit|try again|fraud|security/);
  });

  it("an idempotent replay (replayed:true) is treated as committed success, not a duplicate warning", () => {
    renderAddExpense();
    fillRequiredFields();
    const { callbacks } = submitAndCaptureCallbacks(mockAddMutate, 0);

    act(() => {
      callbacks.onSuccess({
        success: true,
        message: "Expense Created Successfully",
        data: {},
        derivedData: { status: "synchronized", recoveryPending: false },
        replayed: true,
      });
    });

    expect(mockNavigate).toHaveBeenCalledWith("/");
    expect(expenseAddErrorToast).not.toHaveBeenCalled();
    expect(expenseAddSuccessToast).toHaveBeenCalled();
  });
});

describe("AddExpense -- genuine failure and idempotency-conflict UX", () => {
  let mockAddMutate;

  beforeEach(() => {
    mockAddMutate = jest.fn();
    useAddExpenseMutation.mockReturnValue({ mutate: mockAddMutate });
    useUpdateExpenseMutation.mockReturnValue({ mutate: jest.fn() });
  });

  it("a genuine primary failure (500) keeps the failure UX: form state kept, not navigated, error toast shown", () => {
    renderAddExpense();
    fillRequiredFields({ name: "Failing entry" });
    const { callbacks } = submitAndCaptureCallbacks(mockAddMutate, 0);

    act(() => {
      callbacks.onError({ response: { status: 500, data: { message: "Internal Server Error" } } });
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(expenseAddErrorToast).toHaveBeenCalledWith({ message: "Internal Server Error" });
    // Form state preserved for correction -- not silently cleared.
    expect(screen.getByLabelText(/name of the expense/i).value).toBe("Failing entry");
  });

  it("an idempotency conflict (409) is a controlled error, not masqueraded as success -- form stays open, no duplicate resubmit id change", () => {
    renderAddExpense();
    fillRequiredFields({ name: "Conflicting entry" });
    const { payload, callbacks } = submitAndCaptureCallbacks(mockAddMutate, 0);

    act(() => {
      // 409 is already surfaced by the shared axios interceptor -- the
      // component's own onError intentionally no-ops for it.
      callbacks.onError({ response: { status: 409, data: { errorCode: "IDEMPOTENCY_KEY_CONFLICT" } } });
    });

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(expenseAddErrorToast).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/name of the expense/i).value).toBe("Conflicting entry");

    // Retrying after a conflict must not silently mint a new id behind the
    // user's back -- the same id is reused until an explicit new attempt.
    fireEvent.submit(document.querySelector("form.add-expense"));
    expect(mockAddMutate.mock.calls[1][0].id).toBe(payload.id);
  });
});
