// CAT-001-T05 -- post-submit "save this correction as a merchant rule?" prompt.
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

beforeEach(() => {
  queryClient.fetchQuery.mockResolvedValue({ data: null });
  process.env.REACT_APP_BACKEND_URL = "http://localhost:8080";
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ predictedCategory: "Food", confidence: 92 }),
    })
  );
});

afterEach(() => {
  jest.clearAllMocks();
  delete global.fetch;
});

function renderAddExpense() {
  return render(<AddExpense isEdit={{ enableEdit: false, expense_id: "" }} setIsEdit={jest.fn()} />);
}

async function fillNameAndWaitForPrediction(name = "Starbucks Coffee") {
  fireEvent.change(screen.getByLabelText(/name of the expense/i), { target: { value: name } });
  await waitFor(() => expect(screen.getByLabelText(/category/i)).toHaveValue("Food"));
}

function fillRemainingFieldsAndSubmit() {
  fireEvent.change(screen.getByLabelText(/amount spent/i), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText(/date spent/i), { target: { value: "2026-01-15" } });
  fireEvent.submit(document.querySelector("form.add-expense"));
}

describe("AddExpense -- save-rule prompt (CAT-001-T05)", () => {
  let mockAddMutate;
  let mockSaveRuleMutate;

  beforeEach(() => {
    mockAddMutate = jest.fn((_payload, { onSuccess }) => onSuccess({}));
    useAddExpenseMutation.mockReturnValue({ mutate: mockAddMutate });
    useUpdateExpenseMutation.mockReturnValue({ mutate: jest.fn() });
    mockSaveRuleMutate = jest.fn();
    useSaveMerchantRuleMutation.mockReturnValue({ mutate: mockSaveRuleMutate, isPending: false });
  });

  it("prompts to save a rule when the submitted category overrides the ML prediction", async () => {
    renderAddExpense();
    await fillNameAndWaitForPrediction();

    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Entertainment" } });
    fillRemainingFieldsAndSubmit();

    expect(await screen.findByText(/remember that/i)).toBeInTheDocument();
    expect(screen.getByText("Starbucks Coffee")).toBeInTheDocument();
    expect(screen.getByText("Entertainment")).toBeInTheDocument();
  });

  it("does not prompt when the submitted category matches the ML prediction", async () => {
    renderAddExpense();
    await fillNameAndWaitForPrediction();

    fillRemainingFieldsAndSubmit();

    await waitFor(() => expect(mockAddMutate).toHaveBeenCalled());
    expect(screen.queryByText(/remember that/i)).not.toBeInTheDocument();
  });

  it("does not prompt for a plain, uncorrected submission with no ML prediction at all", () => {
    renderAddExpense();

    fireEvent.change(screen.getByLabelText(/name of the expense/i), { target: { value: "AB" } }); // under the 3-char debounce threshold
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Food" } });
    fillRemainingFieldsAndSubmit();

    expect(mockAddMutate).toHaveBeenCalled();
    expect(screen.queryByText(/remember that/i)).not.toBeInTheDocument();
  });

  it("confirming the prompt saves the merchant rule and shows a success toast", async () => {
    mockSaveRuleMutate.mockImplementation((_vars, { onSuccess }) => onSuccess());
    renderAddExpense();
    await fillNameAndWaitForPrediction();

    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Entertainment" } });
    fillRemainingFieldsAndSubmit();

    fireEvent.click(await screen.findByRole("button", { name: /save rule/i }));

    expect(mockSaveRuleMutate).toHaveBeenCalledWith(
      { merchantName: "Starbucks Coffee", category: "Entertainment" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );
    expect(merchantRuleSaveSuccessToast).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/remember that/i)).not.toBeInTheDocument();
  });

  it("surfaces a save-rule error via the error toast and still dismisses the prompt", async () => {
    mockSaveRuleMutate.mockImplementation((_vars, { onError }) => onError({ response: { data: { message: "boom" } } }));
    renderAddExpense();
    await fillNameAndWaitForPrediction();

    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Entertainment" } });
    fillRemainingFieldsAndSubmit();

    fireEvent.click(await screen.findByRole("button", { name: /save rule/i }));

    expect(merchantRuleSaveErrorToast).toHaveBeenCalledWith({ message: "boom" });
    expect(screen.queryByText(/remember that/i)).not.toBeInTheDocument();
  });

  it("dismissing the prompt does not save a rule", async () => {
    renderAddExpense();
    await fillNameAndWaitForPrediction();

    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Entertainment" } });
    fillRemainingFieldsAndSubmit();

    fireEvent.click(await screen.findByRole("button", { name: /no thanks/i }));

    expect(mockSaveRuleMutate).not.toHaveBeenCalled();
    expect(screen.queryByText(/remember that/i)).not.toBeInTheDocument();
  });
});
