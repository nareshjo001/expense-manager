// ML-003-T06 -- a "Save merchant rule" shortcut on the abstention
// suggestion banner (ML-003-T04) that fills the category AND saves a
// merchant rule in one click, instead of waiting for the separate
// post-submit CAT-001-T05 prompt. Reuses the exact mock setup established
// in AddExpense.abstentionSuggestion.test.js (T04).
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

let mockSaveRuleMutate;

beforeEach(() => {
  queryClient.fetchQuery.mockResolvedValue({ data: null });
  process.env.REACT_APP_BACKEND_URL = "http://localhost:8080";
  useAddExpenseMutation.mockReturnValue({ mutate: jest.fn() });
  useUpdateExpenseMutation.mockReturnValue({ mutate: jest.fn() });
  mockSaveRuleMutate = jest.fn((_vars, { onSuccess }) => onSuccess());
  useSaveMerchantRuleMutation.mockReturnValue({ mutate: mockSaveRuleMutate, isPending: false });
});

afterEach(() => {
  jest.clearAllMocks();
  delete global.fetch;
});

function renderAddExpense() {
  return render(<AddExpense isEdit={{ enableEdit: false, expense_id: "" }} setIsEdit={jest.fn()} />);
}

describe("AddExpense -- ML-003-T06 'Save merchant rule' shortcut on the abstention banner", () => {
  it("fills the category AND saves a merchant rule for this exact merchant/category in one click", async () => {
    mockPrediction({ predictedCategory: "Personal Care", confidence: 62, abstained: true, abstentionReason: "low_confidence" });
    renderAddExpense();

    fireEvent.change(screen.getByLabelText(/name of the expense/i), { target: { value: "Some New Merchant" } });
    fireEvent.click(await screen.findByRole("button", { name: /save merchant rule/i }));

    expect(screen.getByLabelText(/category/i)).toHaveValue("Personal Care");
    expect(mockSaveRuleMutate).toHaveBeenCalledTimes(1);
    const [vars] = mockSaveRuleMutate.mock.calls[0];
    expect(vars).toEqual({ merchantName: "Some New Merchant", category: "Personal Care" });
  });

  it("dismisses the suggestion banner (category is no longer empty) after the shortcut is used", async () => {
    mockPrediction({ predictedCategory: "Personal Care", confidence: 62, abstained: true, abstentionReason: "low_confidence" });
    renderAddExpense();

    fireEvent.change(screen.getByLabelText(/name of the expense/i), { target: { value: "Some New Merchant" } });
    fireEvent.click(await screen.findByRole("button", { name: /save merchant rule/i }));

    expect(screen.queryByText(/did you mean/i)).not.toBeInTheDocument();
  });

  it("shows the success toast when the rule save succeeds", async () => {
    mockPrediction({ predictedCategory: "Personal Care", confidence: 62, abstained: true, abstentionReason: "low_confidence" });
    renderAddExpense();

    fireEvent.change(screen.getByLabelText(/name of the expense/i), { target: { value: "Some New Merchant" } });
    fireEvent.click(await screen.findByRole("button", { name: /save merchant rule/i }));

    expect(merchantRuleSaveSuccessToast).toHaveBeenCalledTimes(1);
  });

  it("shows the error toast (and still leaves the category filled) when the rule save fails", async () => {
    mockPrediction({ predictedCategory: "Personal Care", confidence: 62, abstained: true, abstentionReason: "low_confidence" });
    const failingMutate = jest.fn((_vars, { onError }) => onError({ response: { data: { message: "boom" } } }));
    useSaveMerchantRuleMutation.mockReturnValue({ mutate: failingMutate, isPending: false });
    renderAddExpense();

    fireEvent.change(screen.getByLabelText(/name of the expense/i), { target: { value: "Some New Merchant" } });
    fireEvent.click(await screen.findByRole("button", { name: /save merchant rule/i }));

    expect(merchantRuleSaveErrorToast).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/category/i)).toHaveValue("Personal Care");
  });

  it("does not create a rule when the plain 'Use this' button is clicked instead", async () => {
    mockPrediction({ predictedCategory: "Personal Care", confidence: 62, abstained: true, abstentionReason: "low_confidence" });
    renderAddExpense();

    fireEvent.change(screen.getByLabelText(/name of the expense/i), { target: { value: "Some New Merchant" } });
    fireEvent.click(await screen.findByRole("button", { name: "Use this" }));

    expect(screen.getByLabelText(/category/i)).toHaveValue("Personal Care");
    expect(mockSaveRuleMutate).not.toHaveBeenCalled();
  });

  it("does not falsely offer the shortcut for a committed (non-abstained) prediction", async () => {
    mockPrediction({ predictedCategory: "Food", confidence: 92, abstained: false, abstentionReason: null });
    renderAddExpense();

    fireEvent.change(screen.getByLabelText(/name of the expense/i), { target: { value: "Starbucks Coffee" } });
    await waitFor(() => expect(screen.getByLabelText(/category/i)).toHaveValue("Food"));

    expect(screen.queryByRole("button", { name: /save merchant rule/i })).not.toBeInTheDocument();
  });
});
