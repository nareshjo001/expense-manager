// ML-003-T05 -- the submit payload carries `mlAbstained` alongside the
// existing ML telemetry fields, so the backend can derive a
// viewed/accepted/corrected/abstained outcome. Reuses the exact mock setup
// established in AddExpense.abstentionSuggestion.test.js (T04).
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AddExpense from "./AddExpense";
import { useAddExpenseMutation } from "../../hooks/mutations/useAddExpenseMutation";
import { useUpdateExpenseMutation } from "../../hooks/mutations/useUpdateExpenseMutation";
import { useSaveMerchantRuleMutation } from "../../hooks/mutations/useSaveMerchantRuleMutation";
import {
  expenseAddSuccessToast,
  expenseAddErrorToast,
  merchantRuleSaveSuccessToast,
  merchantRuleSaveErrorToast,
} from "../alertsEffects/toastMessages";
import { queryClient } from "../../query/queryClient";

jest.mock("../../hooks/mutations/useAddExpenseMutation", () => ({
  useAddExpenseMutation: jest.fn(),
}));
jest.mock("../../hooks/mutations/useUpdateExpenseMutation", () => ({
  useUpdateExpenseMutation: jest.fn(),
}));
jest.mock("../../hooks/mutations/useSaveMerchantRuleMutation", () => ({
  useSaveMerchantRuleMutation: jest.fn(),
}));
jest.mock("../alertsEffects/toastMessages", () => ({
  expenseAddSuccessToast: jest.fn(),
  expenseAddErrorToast: jest.fn(),
  merchantRuleSaveSuccessToast: jest.fn(),
  merchantRuleSaveErrorToast: jest.fn(),
}));
jest.mock("../billScanner/BillUpload", () => () => null);
jest.mock("../../api/expenseApi", () => ({
  getExpenseEditData: jest.fn(),
}));
jest.mock("../../query/queryClient", () => ({
  queryClient: { fetchQuery: jest.fn() },
}));

const mockNavigate = jest.fn();
jest.mock(
  "react-router-dom",
  () => ({
    useNavigate: () => mockNavigate,
  }),
  { virtual: true }
);

function mockPrediction(body) {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    })
  );
}

let mockAddMutate;

beforeEach(() => {
  queryClient.fetchQuery.mockResolvedValue({ data: null });
  process.env.REACT_APP_BACKEND_URL = "http://localhost:8080";
  mockAddMutate = jest.fn();
  useAddExpenseMutation.mockReturnValue({ mutate: mockAddMutate });
  useUpdateExpenseMutation.mockReturnValue({ mutate: jest.fn() });
  useSaveMerchantRuleMutation.mockReturnValue({ mutate: jest.fn(), isPending: false });
});

afterEach(() => {
  jest.clearAllMocks();
  delete global.fetch;
});

function renderAddExpense() {
  return render(<AddExpense isEdit={{ enableEdit: false, expense_id: "" }} setIsEdit={jest.fn()} />);
}

function fillAndSubmit({ name, amount, date, category }) {
  fireEvent.change(screen.getByLabelText(/name of the expense/i), { target: { value: name } });
  if (category !== undefined) {
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: category } });
  }
  fireEvent.change(screen.getByLabelText(/amount spent/i), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText(/date spent/i), { target: { value: date } });
  // handleSubmit is wired to the form's onSubmit, not the button's onClick --
  // matches the established pattern in AddExpense.test.js's
  // submitAndCaptureCallbacks(), not a click on the submit button.
  fireEvent.submit(document.querySelector("form.add-expense"));
}

describe("AddExpense -- ML-003-T05 mlAbstained included in the submit payload", () => {
  it("sends mlAbstained: false for a committed (non-abstained) prediction that was kept", async () => {
    mockPrediction({ predictedCategory: "Food", confidence: 92, abstained: false, abstentionReason: null });
    renderAddExpense();

    fireEvent.change(screen.getByLabelText(/name of the expense/i), { target: { value: "Starbucks Coffee" } });
    await waitFor(() => expect(screen.getByLabelText(/category/i)).toHaveValue("Food"));

    fillAndSubmit({ name: "Starbucks Coffee", amount: "5.5", date: "2026-01-15" });

    expect(mockAddMutate).toHaveBeenCalledTimes(1);
    const payload = mockAddMutate.mock.calls[0][0];
    expect(payload.mlAbstained).toBe(false);
    expect(payload.mlPredictedCategory).toBe("Food");
  });

  it("sends mlAbstained: true when the submitted category matches an abstained suggestion that was accepted", async () => {
    mockPrediction({ predictedCategory: "Personal Care", confidence: 62, abstained: true, abstentionReason: "low_confidence" });
    renderAddExpense();

    fireEvent.change(screen.getByLabelText(/name of the expense/i), { target: { value: "Some New Merchant" } });
    fireEvent.click(await screen.findByRole("button", { name: /use this/i }));
    expect(screen.getByLabelText(/category/i)).toHaveValue("Personal Care");

    fillAndSubmit({ name: "Some New Merchant", amount: "12", date: "2026-01-16" });

    expect(mockAddMutate).toHaveBeenCalledTimes(1);
    const payload = mockAddMutate.mock.calls[0][0];
    expect(payload.mlAbstained).toBe(true);
    expect(payload.mlPredictedCategory).toBe("Personal Care");
    expect(payload.expenseCategory).toBe("Personal Care");
  });

  it("still sends mlAbstained: true when an abstained suggestion is overridden by the user's own typed category", async () => {
    mockPrediction({ predictedCategory: "Personal Care", confidence: 62, abstained: true, abstentionReason: "low_confidence" });
    renderAddExpense();

    fireEvent.change(screen.getByLabelText(/name of the expense/i), { target: { value: "Some New Merchant" } });
    await screen.findByText(/did you mean/i);

    fillAndSubmit({ name: "Some New Merchant", amount: "12", date: "2026-01-16", category: "Travel" });

    expect(mockAddMutate).toHaveBeenCalledTimes(1);
    const payload = mockAddMutate.mock.calls[0][0];
    // The original prediction was abstained even though the user overrode it --
    // mlAbstained reflects that history, wasMlCorrected captures the override.
    expect(payload.mlAbstained).toBe(true);
    expect(payload.wasMlCorrected).toBe(true);
    expect(payload.expenseCategory).toBe("Travel");
  });
});
