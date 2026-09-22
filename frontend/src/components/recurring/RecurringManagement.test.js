// REC-002-T05 -- recurring-definition management screen (list, status
// badges, pause/resume/end, edit). Same hook-mocking pattern as
// MerchantRules.test.js -- mock the query/mutation hooks directly rather
// than standing up a real QueryClientProvider, since this component's own
// logic (what it renders per status, what it calls with what arguments) is
// the thing under test, not TanStack Query itself.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import RecurringManagement from "./RecurringManagement";
import { useRecurringDefinitionsQuery } from "../../hooks/queries/useRecurringDefinitionsQuery";
import { usePauseRecurringMutation } from "../../hooks/mutations/usePauseRecurringMutation";
import { useResumeRecurringMutation } from "../../hooks/mutations/useResumeRecurringMutation";
import { useEndRecurringMutation } from "../../hooks/mutations/useEndRecurringMutation";
import { useEditRecurringMutation } from "../../hooks/mutations/useEditRecurringMutation";
import {
  recurringActionSuccessToast,
  recurringActionErrorToast,
} from "../alertsEffects/toastMessages";

jest.mock("../../hooks/queries/useRecurringDefinitionsQuery", () => ({
  useRecurringDefinitionsQuery: jest.fn(),
}));
jest.mock("../../hooks/mutations/usePauseRecurringMutation", () => ({
  usePauseRecurringMutation: jest.fn(),
}));
jest.mock("../../hooks/mutations/useResumeRecurringMutation", () => ({
  useResumeRecurringMutation: jest.fn(),
}));
jest.mock("../../hooks/mutations/useEndRecurringMutation", () => ({
  useEndRecurringMutation: jest.fn(),
}));
jest.mock("../../hooks/mutations/useEditRecurringMutation", () => ({
  useEditRecurringMutation: jest.fn(),
}));
jest.mock("../alertsEffects/toastMessages", () => ({
  recurringActionSuccessToast: jest.fn(),
  recurringActionErrorToast: jest.fn(),
}));

function definition(overrides = {}) {
  return {
    id: "rec-1",
    expenseId: "exp-1",
    expenseName: "Netflix",
    expenseCategory: "Entertainment",
    expenseAmount: 500,
    expenseAmountMinor: 50000,
    status: "active",
    nextDueDate: "2026-10-01T00:00:00.000Z",
    endDate: null,
    scheduleVersion: 4,
    ...overrides,
  };
}

function setupMutations({
  pauseMutate = jest.fn(),
  resumeMutate = jest.fn(),
  endMutate = jest.fn(),
  editMutate = jest.fn(),
} = {}) {
  usePauseRecurringMutation.mockReturnValue({ mutate: pauseMutate, isPending: false });
  useResumeRecurringMutation.mockReturnValue({ mutate: resumeMutate, isPending: false });
  useEndRecurringMutation.mockReturnValue({ mutate: endMutate, isPending: false });
  useEditRecurringMutation.mockReturnValue({ mutate: editMutate, isPending: false });
  return { pauseMutate, resumeMutate, endMutate, editMutate };
}

afterEach(() => {
  jest.clearAllMocks();
});

describe("RecurringManagement -- loading/error/empty states", () => {
  it("shows the loading state while the query is in flight", () => {
    useRecurringDefinitionsQuery.mockReturnValue({ isLoading: true, isError: false, data: undefined, refetch: jest.fn() });
    setupMutations();

    render(<RecurringManagement />);

    expect(screen.getByText(/loading your recurring expenses/i)).toBeInTheDocument();
  });

  it("shows the error state with a working retry button", () => {
    const refetch = jest.fn();
    useRecurringDefinitionsQuery.mockReturnValue({ isLoading: false, isError: true, data: undefined, refetch });
    setupMutations();

    render(<RecurringManagement />);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows the empty state when there are no definitions", () => {
    useRecurringDefinitionsQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { success: true, data: [] },
      refetch: jest.fn(),
    });
    setupMutations();

    render(<RecurringManagement />);

    expect(screen.getByText(/no recurring expenses set up yet/i)).toBeInTheDocument();
  });
});

describe("RecurringManagement -- status-aware rendering", () => {
  it("an active definition offers Pause, Edit and End but not Resume", () => {
    useRecurringDefinitionsQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { success: true, data: [definition({ status: "active" })] },
      refetch: jest.fn(),
    });
    setupMutations();

    render(<RecurringManagement />);

    expect(screen.getByText("Netflix")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^end$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /resume/i })).not.toBeInTheDocument();
  });

  it("a paused definition offers Resume, Edit and End but not Pause", () => {
    useRecurringDefinitionsQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { success: true, data: [definition({ status: "paused" })] },
      refetch: jest.fn(),
    });
    setupMutations();

    render(<RecurringManagement />);

    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^end$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^pause$/i })).not.toBeInTheDocument();
  });

  it("an ended definition is terminal: no Pause, Resume, Edit or End", () => {
    useRecurringDefinitionsQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { success: true, data: [definition({ status: "ended", endedAt: "2026-09-01T00:00:00.000Z" })] },
      refetch: jest.fn(),
    });
    setupMutations();

    render(<RecurringManagement />);

    expect(screen.getByText("Ended")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pause/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /resume/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^end$/i })).not.toBeInTheDocument();
  });
});

describe("RecurringManagement -- actions", () => {
  it("pausing calls the mutation with the definition id", () => {
    useRecurringDefinitionsQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { success: true, data: [definition({ status: "active" })] },
      refetch: jest.fn(),
    });
    const { pauseMutate } = setupMutations();

    render(<RecurringManagement />);
    fireEvent.click(screen.getByRole("button", { name: /pause/i }));

    expect(pauseMutate).toHaveBeenCalledWith(
      { id: "rec-1" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );
  });

  it("resuming calls the mutation with the definition id", () => {
    useRecurringDefinitionsQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { success: true, data: [definition({ status: "paused" })] },
      refetch: jest.fn(),
    });
    const { resumeMutate } = setupMutations();

    render(<RecurringManagement />);
    fireEvent.click(screen.getByRole("button", { name: /resume/i }));

    expect(resumeMutate).toHaveBeenCalledWith({ id: "rec-1" }, expect.any(Object));
  });

  it("ending requires confirmation before calling the mutation", () => {
    useRecurringDefinitionsQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { success: true, data: [definition({ status: "active" })] },
      refetch: jest.fn(),
    });
    const { endMutate } = setupMutations();

    render(<RecurringManagement />);
    fireEvent.click(screen.getByRole("button", { name: /^end$/i }));

    expect(endMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /yes, end/i }));
    expect(endMutate).toHaveBeenCalledWith({ id: "rec-1" }, expect.any(Object));
  });

  it("canceling the end confirmation does not call the mutation", () => {
    useRecurringDefinitionsQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { success: true, data: [definition({ status: "active" })] },
      refetch: jest.fn(),
    });
    const { endMutate } = setupMutations();

    render(<RecurringManagement />);
    fireEvent.click(screen.getByRole("button", { name: /^end$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(endMutate).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("editing submits the current scheduleVersion along with the changed fields", () => {
    useRecurringDefinitionsQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { success: true, data: [definition({ status: "active", scheduleVersion: 7 })] },
      refetch: jest.fn(),
    });
    const { editMutate } = setupMutations();

    render(<RecurringManagement />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Netflix Premium" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(editMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "rec-1",
        scheduleVersion: 7,
        updates: expect.objectContaining({ expenseName: "Netflix Premium" }),
      }),
      expect.any(Object)
    );
  });

  it("canceling the edit form discards changes without calling the mutation", () => {
    useRecurringDefinitionsQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { success: true, data: [definition({ status: "active" })] },
      refetch: jest.fn(),
    });
    const { editMutate } = setupMutations();

    render(<RecurringManagement />);
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(editMutate).not.toHaveBeenCalled();
    expect(screen.getByText("Netflix")).toBeInTheDocument();
  });
});
