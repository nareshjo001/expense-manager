// CAT-001-T06 -- merchant rule management screen (list/add/edit/delete).
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import MerchantRules from "./MerchantRules";
import { useMerchantRulesQuery } from "../../hooks/queries/useMerchantRulesQuery";
import { useSaveMerchantRuleMutation } from "../../hooks/mutations/useSaveMerchantRuleMutation";
import { useDeleteMerchantRuleMutation } from "../../hooks/mutations/useDeleteMerchantRuleMutation";
import {
  merchantRuleSaveSuccessToast,
  merchantRuleSaveErrorToast,
  merchantRuleDeleteSuccessToast,
  merchantRuleDeleteErrorToast,
} from "../alertsEffects/toastMessages";

jest.mock("../../hooks/queries/useMerchantRulesQuery", () => ({
  useMerchantRulesQuery: jest.fn(),
}));
jest.mock("../../hooks/mutations/useSaveMerchantRuleMutation", () => ({
  useSaveMerchantRuleMutation: jest.fn(),
}));
jest.mock("../../hooks/mutations/useDeleteMerchantRuleMutation", () => ({
  useDeleteMerchantRuleMutation: jest.fn(),
}));
jest.mock("../alertsEffects/toastMessages", () => ({
  merchantRuleSaveSuccessToast: jest.fn(),
  merchantRuleSaveErrorToast: jest.fn(),
  merchantRuleDeleteSuccessToast: jest.fn(),
  merchantRuleDeleteErrorToast: jest.fn(),
}));

const RULES = [
  { _id: "rule-1", merchantKey: "starbucks", category: "Food" },
  { _id: "rule-2", merchantKey: "shell gas", category: "Transport" },
];

function setupMutations({ saveMutate = jest.fn(), deleteMutate = jest.fn() } = {}) {
  useSaveMerchantRuleMutation.mockReturnValue({ mutate: saveMutate, isPending: false });
  useDeleteMerchantRuleMutation.mockReturnValue({ mutate: deleteMutate, isPending: false });
  return { saveMutate, deleteMutate };
}

const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
});

afterEach(() => {
  jest.clearAllMocks();
  window.HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

describe("MerchantRules -- loading/error/empty states", () => {
  it("shows the loading state while the query is in flight", () => {
    useMerchantRulesQuery.mockReturnValue({ isLoading: true, isError: false, data: undefined, refetch: jest.fn() });
    setupMutations();

    render(<MerchantRules />);

    expect(screen.getByText(/loading your merchant rules/i)).toBeInTheDocument();
  });

  it("shows the error state with a working retry button", () => {
    const refetch = jest.fn();
    useMerchantRulesQuery.mockReturnValue({ isLoading: false, isError: true, data: undefined, refetch });
    setupMutations();

    render(<MerchantRules />);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state when no rules are saved yet", () => {
    useMerchantRulesQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { success: true, data: [] },
      refetch: jest.fn(),
    });
    setupMutations();

    render(<MerchantRules />);

    expect(screen.getByText(/no merchant rules saved yet/i)).toBeInTheDocument();
  });
});

describe("MerchantRules -- listing and editing", () => {
  beforeEach(() => {
    useMerchantRulesQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { success: true, data: RULES },
      refetch: jest.fn(),
    });
  });

  it("lists every saved rule with its merchant and category", () => {
    setupMutations();
    render(<MerchantRules />);

    expect(screen.getByText("Starbucks")).toBeInTheDocument();
    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.getByText("Shell Gas")).toBeInTheDocument();
    expect(screen.getByText("Transport")).toBeInTheDocument();
  });

  it("submitting the add form saves a new rule and resets the form on success", () => {
    const saveMutate = jest.fn((_vars, { onSuccess }) => onSuccess());
    setupMutations({ saveMutate });
    render(<MerchantRules />);

    fireEvent.change(screen.getByLabelText(/merchant/i), { target: { value: "Costco" } });
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Groceries" } });
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));

    expect(saveMutate).toHaveBeenCalledWith(
      { merchantName: "Costco", category: "Groceries" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );
    expect(merchantRuleSaveSuccessToast).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/merchant/i)).toHaveValue("");
  });

  it("surfaces a save error via the error toast without resetting the form", () => {
    const saveMutate = jest.fn((_vars, { onError }) => onError({ response: { data: { message: "boom" } } }));
    setupMutations({ saveMutate });
    render(<MerchantRules />);

    fireEvent.change(screen.getByLabelText(/merchant/i), { target: { value: "Costco" } });
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Groceries" } });
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));

    expect(merchantRuleSaveErrorToast).toHaveBeenCalledWith({ message: "boom" });
    expect(screen.getByLabelText(/merchant/i)).toHaveValue("Costco");
  });

  it("clicking Edit loads the rule into the form and switches to update mode; Cancel clears it", () => {
    setupMutations();
    render(<MerchantRules />);

    fireEvent.click(screen.getAllByRole("button", { name: /^edit$/i })[0]);

    expect(screen.getByLabelText(/merchant/i)).toHaveValue("starbucks");
    expect(screen.getByLabelText(/category/i)).toHaveValue("Food");
    expect(screen.getByRole("button", { name: /update rule/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.getByLabelText(/merchant/i)).toHaveValue("");
    expect(screen.getByRole("button", { name: /add rule/i })).toBeInTheDocument();
  });

  it("clicking Edit auto-scrolls up to visually focus the form card", () => {
    setupMutations();
    const scrollIntoViewMock = jest.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

    const { container } = render(<MerchantRules />);
    const card = container.querySelector(".merchant-rules-card");

    expect(card).not.toHaveClass("merchant-rules-card--editing");

    fireEvent.click(screen.getAllByRole("button", { name: /^edit$/i })[0]);

    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(card).toHaveClass("merchant-rules-card--editing");
  });
});

describe("MerchantRules -- deleting a rule", () => {
  beforeEach(() => {
    useMerchantRulesQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { success: true, data: RULES },
      refetch: jest.fn(),
    });
  });

  it("asks for confirmation before deleting, and does nothing on cancel", () => {
    const deleteMutate = jest.fn();
    setupMutations({ deleteMutate });
    render(<MerchantRules />);

    fireEvent.click(screen.getAllByRole("button", { name: /^delete$/i })[0]);
    expect(screen.getByText(/are you sure you want to delete this merchant rule/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(deleteMutate).not.toHaveBeenCalled();
    expect(screen.queryByText(/are you sure you want to delete this merchant rule/i)).not.toBeInTheDocument();
  });

  it("deletes the confirmed rule and shows a success toast", () => {
    const deleteMutate = jest.fn((_ruleId, { onSuccess }) => onSuccess());
    setupMutations({ deleteMutate });
    render(<MerchantRules />);

    fireEvent.click(screen.getAllByRole("button", { name: /^delete$/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /yes, delete/i }));

    expect(deleteMutate).toHaveBeenCalledWith("rule-1", expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }));
    expect(merchantRuleDeleteSuccessToast).toHaveBeenCalledTimes(1);
  });

  it("surfaces a delete error via the error toast", () => {
    const deleteMutate = jest.fn((_ruleId, { onError }) => onError({ response: { data: { message: "nope" } } }));
    setupMutations({ deleteMutate });
    render(<MerchantRules />);

    fireEvent.click(screen.getAllByRole("button", { name: /^delete$/i })[0]);
    fireEvent.click(screen.getByRole("button", { name: /yes, delete/i }));

    expect(merchantRuleDeleteErrorToast).toHaveBeenCalledWith({ message: "nope" });
  });
});

describe("MerchantRules -- Saved Rules display formatting & scrollable list behavior", () => {
  it("displays the first word of the category with its first letter capitalized", () => {
    const customRules = [
      { _id: "r1", merchantKey: "swiggy", category: "food & drink" },
      { _id: "r2", merchantKey: "bigbasket", category: "groceries online" },
      { _id: "r3", merchantKey: "netflix", category: "ENTERTAINMENT" },
    ];
    useMerchantRulesQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { success: true, data: customRules },
      refetch: jest.fn(),
    });
    setupMutations();

    render(<MerchantRules />);

    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.getByText("Groceries")).toBeInTheDocument();
    expect(screen.getByText("Entertainment")).toBeInTheDocument();
  });

  it("displays merchant names with their first letter capitalized (e.g. exam fee -> Exam Fee)", () => {
    const customRules = [
      { _id: "r-exam", merchantKey: "exam fee", category: "Education" },
      { _id: "r-swiggy", merchantKey: "swiggy", category: "food" },
    ];
    useMerchantRulesQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { success: true, data: customRules },
      refetch: jest.fn(),
    });
    setupMutations();

    render(<MerchantRules />);

    expect(screen.getByText("Exam Fee")).toBeInTheDocument();
    expect(screen.getByText("Education")).toBeInTheDocument();
    expect(screen.getByText("Swiggy")).toBeInTheDocument();
    expect(screen.getByText("Food")).toBeInTheDocument();
  });

  it("does not apply scrollable class when 5 or fewer rules exist", () => {
    const fiveRules = Array.from({ length: 5 }, (_, i) => ({
      _id: `rule-${i + 1}`,
      merchantKey: `merchant-${i + 1}`,
      category: "Food",
    }));

    useMerchantRulesQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { success: true, data: fiveRules },
      refetch: jest.fn(),
    });
    setupMutations();

    const { container } = render(<MerchantRules />);
    const list = container.querySelector(".merchant-rules-list");

    expect(list).not.toHaveClass("merchant-rules-list--scrollable");
    expect(list.children).toHaveLength(5);
  });

  it("applies scrollable class when more than 5 rules exist", () => {
    const sixRules = Array.from({ length: 6 }, (_, i) => ({
      _id: `rule-${i + 1}`,
      merchantKey: `merchant-${i + 1}`,
      category: "Food",
    }));

    useMerchantRulesQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { success: true, data: sixRules },
      refetch: jest.fn(),
    });
    setupMutations();

    const { container } = render(<MerchantRules />);
    const list = container.querySelector(".merchant-rules-list");

    expect(list).toHaveClass("merchant-rules-list--scrollable");
    expect(list.children).toHaveLength(6);
  });
});
