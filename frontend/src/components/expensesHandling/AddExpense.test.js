// Phase C -- Expense Mutation Reliability, Recovery, and Idempotency.
import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import AddExpense from "./AddExpense";
import { useAddExpenseMutation } from "../../hooks/mutations/useAddExpenseMutation";
import { useUpdateExpenseMutation } from "../../hooks/mutations/useUpdateExpenseMutation";
import { expenseAddSuccessToast, expenseAddErrorToast } from "../alertsEffects/toastMessages";
import { queryClient } from "../../query/queryClient";

// Explicit factories (not bare jest.mock(path) auto-mocking) so Jest never
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
beforeEach(() => {
  queryClient.fetchQuery.mockResolvedValue({ data: null });
});

// Fully hand-mocked (no jest.requireActual, no Router wrapper needed) --
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

// Category Normalization -- single implementation pass, required test
describe("AddExpense -- Category Normalization: edit-load display and unknown-category submit", () => {
  beforeEach(() => {
    useAddExpenseMutation.mockReturnValue({ mutate: jest.fn() });
    useUpdateExpenseMutation.mockReturnValue({ mutate: jest.fn() });
  });

  it("#17: displays a historical category's mechanically-normalized (trimmed/collapsed/Title-Cased) form when loaded into edit mode", async () => {
    queryClient.fetchQuery.mockResolvedValue({
      data: {
        expenseName: "Doctor visit",
        expenseCategory: "  medical   checkup ",
        expenseAmount: 200,
        expenseDate: "2026-01-10T00:00:00.000Z",
        expenseDescription: "Routine checkup",
      },
    });

    await act(async () => {
      renderAddExpense({ enableEdit: true, expense_id: "existing-expense-1" }, jest.fn());
    });
    await waitFor(() => expect(queryClient.fetchQuery).toHaveBeenCalled());

    // Same mechanical cleanup AddExpense.js's own submit-time
    await waitFor(() =>
      expect(screen.getByLabelText(/category/i).value).toBe("Medical Checkup")
    );
  });

  it("#17b: an already-canonical historical category loads unchanged", async () => {
    queryClient.fetchQuery.mockResolvedValue({
      data: {
        expenseName: "Groceries",
        expenseCategory: "Food",
        expenseAmount: 50,
        expenseDate: "2026-01-10T00:00:00.000Z",
        expenseDescription: "Weekly groceries",
      },
    });

    await act(async () => {
      renderAddExpense({ enableEdit: true, expense_id: "existing-expense-2" }, jest.fn());
    });
    await waitFor(() => expect(queryClient.fetchQuery).toHaveBeenCalled());

    await waitFor(() => expect(screen.getByLabelText(/category/i).value).toBe("Food"));
  });

  it("#18: an unknown/custom category remains freely editable and submits normally (no fixed dropdown/allowlist)", () => {
    const mockAddMutate = jest.fn();
    useAddExpenseMutation.mockReturnValue({ mutate: mockAddMutate });

    renderAddExpense();
    fireEvent.change(screen.getByLabelText(/name of the expense/i), { target: { value: "Fish tank filter" } });
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Pet Supplies" } });
    fireEvent.change(screen.getByLabelText(/amount spent/i), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText(/date spent/i), { target: { value: "2026-01-15" } });

    expect(screen.getByLabelText(/category/i).value).toBe("Pet Supplies");

    fireEvent.submit(document.querySelector("form.add-expense"));

    expect(mockAddMutate).toHaveBeenCalledTimes(1);
    expect(mockAddMutate.mock.calls[0][0].expenseCategory).toBe("Pet Supplies");
  });
});
