// AI-001-T06 -- monthly AI summary opt-in card. Same hook-mocking pattern
// as NotificationPreferences.test.js: mock the query/mutation hooks
// directly rather than standing up a real QueryClientProvider, since this
// component's own rendering logic is what's under test here.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import AiMonthlySummary from "./AiMonthlySummary";
import { useAiSummaryPreferenceQuery } from "../../hooks/queries/useAiSummaryPreferenceQuery";
import { useSaveAiSummaryOptInMutation } from "../../hooks/mutations/useSaveAiSummaryOptInMutation";
import { useGenerateAiMonthlySummaryMutation } from "../../hooks/mutations/useGenerateAiMonthlySummaryMutation";

jest.mock("../../hooks/queries/useAiSummaryPreferenceQuery", () => ({
  useAiSummaryPreferenceQuery: jest.fn(),
}));
jest.mock("../../hooks/mutations/useSaveAiSummaryOptInMutation", () => ({
  useSaveAiSummaryOptInMutation: jest.fn(),
}));
jest.mock("../../hooks/mutations/useGenerateAiMonthlySummaryMutation", () => ({
  useGenerateAiMonthlySummaryMutation: jest.fn(),
}));
jest.mock("../alertsEffects/toastMessages", () => ({
  expenseAddSuccessToast: jest.fn(),
  expenseAddErrorToast: jest.fn(),
}));

function setupQuery(data, overrides = {}) {
  useAiSummaryPreferenceQuery.mockReturnValue({
    isLoading: false,
    isError: false,
    data: data ? { success: true, data } : undefined,
    refetch: jest.fn(),
    ...overrides,
  });
}

function setupOptInMutation(mutate = jest.fn()) {
  useSaveAiSummaryOptInMutation.mockReturnValue({ mutate, isPending: false });
  return mutate;
}

function setupGenerateMutation(overrides = {}) {
  const mutate = jest.fn();
  useGenerateAiMonthlySummaryMutation.mockReturnValue({
    mutate,
    isPending: false,
    data: undefined,
    ...overrides,
  });
  return mutate;
}

afterEach(() => {
  jest.clearAllMocks();
});

describe("AiMonthlySummary -- loading/error states", () => {
  it("shows the loading state while the preference query is in flight", () => {
    setupQuery(null, { isLoading: true });
    setupOptInMutation();
    setupGenerateMutation();

    render(<AiMonthlySummary />);

    expect(screen.getByText(/loading your ai summary settings/i)).toBeInTheDocument();
  });

  it("shows the error state with a working retry button", () => {
    const refetch = jest.fn();
    setupQuery(null, { isError: true, refetch });
    setupOptInMutation();
    setupGenerateMutation();

    render(<AiMonthlySummary />);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe("AiMonthlySummary -- opt-in toggle", () => {
  it("shows the opt-in hint and an unchecked toggle for a user who hasn't opted in", () => {
    setupQuery({ optedIn: false, regenerationsUsed: 0, regenerationsRemaining: 5 });
    setupOptInMutation();
    setupGenerateMutation();

    render(<AiMonthlySummary />);

    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByText(/turn this on to generate a narrative summary/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate summary/i })).not.toBeInTheDocument();
  });

  it("calls the opt-in mutation with true when a not-opted-in user checks the box", () => {
    setupQuery({ optedIn: false, regenerationsUsed: 0, regenerationsRemaining: 5 });
    const mutate = setupOptInMutation();
    setupGenerateMutation();

    render(<AiMonthlySummary />);
    fireEvent.click(screen.getByRole("checkbox"));

    expect(mutate).toHaveBeenCalledWith(true, expect.any(Object));
  });

  it("calls the opt-in mutation with false when an opted-in user unchecks the box", () => {
    setupQuery({ optedIn: true, regenerationsUsed: 1, regenerationsRemaining: 4 });
    const mutate = setupOptInMutation();
    setupGenerateMutation();

    render(<AiMonthlySummary />);
    fireEvent.click(screen.getByRole("checkbox"));

    expect(mutate).toHaveBeenCalledWith(false, expect.any(Object));
  });
});

describe("AiMonthlySummary -- generate flow for an opted-in user", () => {
  it("shows the regeneration count and an enabled generate button under the cap", () => {
    setupQuery({ optedIn: true, regenerationsUsed: 2, regenerationsRemaining: 3 });
    setupOptInMutation();
    setupGenerateMutation();

    render(<AiMonthlySummary />);

    expect(screen.getByText(/3 of 5 regenerations left this month/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate summary/i })).toBeEnabled();
  });

  it("disables the generate button and shows a limit note once the cap is reached", () => {
    setupQuery({ optedIn: true, regenerationsUsed: 5, regenerationsRemaining: 0 });
    setupOptInMutation();
    setupGenerateMutation();

    render(<AiMonthlySummary />);

    expect(screen.getByRole("button", { name: /generate summary/i })).toBeDisabled();
    expect(screen.getByText(/used all of this month's regenerations/i)).toBeInTheDocument();
  });

  it("calls the generate mutation when the button is clicked", () => {
    setupQuery({ optedIn: true, regenerationsUsed: 0, regenerationsRemaining: 5 });
    setupOptInMutation();
    const mutate = setupGenerateMutation();

    render(<AiMonthlySummary />);
    fireEvent.click(screen.getByRole("button", { name: /generate summary/i }));

    expect(mutate).toHaveBeenCalled();
  });

  it("renders the template path's per-section prose with each section's own source facts alongside it", () => {
    setupQuery({ optedIn: true, regenerationsUsed: 1, regenerationsRemaining: 4 });
    setupOptInMutation();
    setupGenerateMutation({
      data: {
        success: true,
        data: {
          hasData: true,
          isFallback: true,
          source: "template",
          periodLabel: "September 2026",
          narrative: "You spent ₹5000 across 10 transactions this month.",
          sections: [
            {
              id: "opening",
              text: "You spent ₹5000 across 10 transactions this month.",
              citedFactIds: ["summary.totalSpent", "summary.transactionCount"],
            },
          ],
          citedFacts: [
            { factId: "summary.totalSpent", label: "Total spent", unit: "currency", value: 5000 },
            { factId: "summary.transactionCount", label: "Transaction count", unit: "count", value: 10 },
          ],
        },
      },
    });

    render(<AiMonthlySummary />);

    expect(screen.getByText("You spent ₹5000 across 10 transactions this month.")).toBeInTheDocument();
    expect(screen.getByText("Total spent")).toBeInTheDocument();
    expect(screen.getByText("₹5000")).toBeInTheDocument();
    expect(screen.getByText("Transaction count")).toBeInTheDocument();
    expect(screen.getByText(/template-based/i)).toBeInTheDocument();
    expect(screen.getByText("September 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /regenerate summary/i })).toBeInTheDocument();
  });

  it("renders the LLM path's narrative with a single source-facts list beneath it", () => {
    setupQuery({ optedIn: true, regenerationsUsed: 1, regenerationsRemaining: 4 });
    setupOptInMutation();
    setupGenerateMutation({
      data: {
        success: true,
        data: {
          hasData: true,
          isFallback: false,
          source: "llm",
          periodLabel: "September 2026",
          narrative: "This month you spent a total of ₹5000.",
          sections: null,
          citedFacts: [{ factId: "summary.totalSpent", label: "Total spent", unit: "currency", value: 5000 }],
        },
      },
    });

    render(<AiMonthlySummary />);

    expect(screen.getByText("This month you spent a total of ₹5000.")).toBeInTheDocument();
    expect(screen.getByText(/source facts/i)).toBeInTheDocument();
    expect(screen.getByText("Total spent")).toBeInTheDocument();
    expect(screen.getByText(/ai-generated/i)).toBeInTheDocument();
  });
});
