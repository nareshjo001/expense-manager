// SIA-001-T06 -- SIA settings page (enable/disable toggle + delete-history
// control). Same hook-mocking pattern as NotificationPreferences.test.js --
// mock the query/mutation hooks directly rather than standing up a real
// QueryClientProvider, since this component's own logic (what it renders,
// what it triggers) is the thing under test.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import SiaPreferences from "./SiaPreferences";
import { useSiaPreferenceQuery } from "../../hooks/queries/useSiaPreferenceQuery";
import { useSaveSiaPreferenceMutation } from "../../hooks/mutations/useSaveSiaPreferenceMutation";
import { useDeleteSiaHistoryMutation } from "../../hooks/mutations/useDeleteSiaHistoryMutation";
import {
  siaPreferenceSaveSuccessToast,
  siaPreferenceSaveErrorToast,
  siaHistoryDeleteSuccessToast,
  siaHistoryDeleteErrorToast,
} from "../alertsEffects/toastMessages";

jest.mock("../../hooks/queries/useSiaPreferenceQuery", () => ({
  useSiaPreferenceQuery: jest.fn(),
}));
jest.mock("../../hooks/mutations/useSaveSiaPreferenceMutation", () => ({
  useSaveSiaPreferenceMutation: jest.fn(),
}));
jest.mock("../../hooks/mutations/useDeleteSiaHistoryMutation", () => ({
  useDeleteSiaHistoryMutation: jest.fn(),
}));
jest.mock("../alertsEffects/toastMessages", () => ({
  siaPreferenceSaveSuccessToast: jest.fn(),
  siaPreferenceSaveErrorToast: jest.fn(),
  siaHistoryDeleteSuccessToast: jest.fn(),
  siaHistoryDeleteErrorToast: jest.fn(),
}));

function setupQuery(data, overrides = {}) {
  useSiaPreferenceQuery.mockReturnValue({
    isLoading: false,
    isError: false,
    data: data ? { success: true, data } : undefined,
    refetch: jest.fn(),
    ...overrides,
  });
}

function setupSaveMutation(mutate = jest.fn()) {
  useSaveSiaPreferenceMutation.mockReturnValue({ mutate, isPending: false });
  return mutate;
}

function setupDeleteMutation(mutate = jest.fn()) {
  useDeleteSiaHistoryMutation.mockReturnValue({ mutate, isPending: false });
  return mutate;
}

afterEach(() => {
  jest.clearAllMocks();
});

describe("SiaPreferences -- loading/error states", () => {
  it("shows the loading state while the query is in flight", () => {
    setupQuery(null, { isLoading: true });
    setupSaveMutation();
    setupDeleteMutation();

    render(<SiaPreferences />);

    expect(screen.getByText(/loading your sia settings/i)).toBeInTheDocument();
  });

  it("shows the error state with a working retry button", () => {
    const refetch = jest.fn();
    setupQuery(null, { isError: true, refetch });
    setupSaveMutation();
    setupDeleteMutation();

    render(<SiaPreferences />);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe("SiaPreferences -- enable/disable toggle", () => {
  it("defaults to checked/enabled when no preference document exists", () => {
    setupQuery(undefined);
    setupSaveMutation();
    setupDeleteMutation();

    render(<SiaPreferences />);

    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByText("SIA is on")).toBeInTheDocument();
  });

  it("reflects a saved enabled: false preference", () => {
    setupQuery({ enabled: false });
    setupSaveMutation();
    setupDeleteMutation();

    render(<SiaPreferences />);

    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByText("SIA is off")).toBeInTheDocument();
  });

  it("toggling off calls the save mutation with false and shows the success toast", () => {
    const mutate = jest.fn((_enabled, { onSuccess }) => onSuccess());
    setupSaveMutation(mutate);
    setupQuery({ enabled: true });
    setupDeleteMutation();

    render(<SiaPreferences />);
    fireEvent.click(screen.getByRole("checkbox"));

    expect(mutate).toHaveBeenCalledWith(false, expect.objectContaining({
      onSuccess: expect.any(Function),
      onError: expect.any(Function),
    }));
    expect(siaPreferenceSaveSuccessToast).toHaveBeenCalledWith(false);
  });

  it("calls the error toast on a failed save", () => {
    const mutate = jest.fn((_enabled, { onError }) => onError({ response: { data: { message: "nope" } } }));
    setupSaveMutation(mutate);
    setupQuery({ enabled: true });
    setupDeleteMutation();

    render(<SiaPreferences />);
    fireEvent.click(screen.getByRole("checkbox"));

    expect(siaPreferenceSaveErrorToast).toHaveBeenCalledWith({ message: "nope" });
  });
});

describe("SiaPreferences -- delete history", () => {
  it("shows a confirmation dialog before deleting, and does nothing until confirmed", () => {
    const mutate = jest.fn();
    setupQuery({ enabled: true });
    setupSaveMutation();
    setupDeleteMutation(mutate);

    render(<SiaPreferences />);
    fireEvent.click(screen.getByRole("button", { name: /delete my sia history/i }));

    expect(screen.getByText(/delete your entire sia conversation history/i)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("confirming the dialog triggers the delete mutation and success toast", () => {
    const mutate = jest.fn((_arg, { onSuccess }) => onSuccess());
    setupQuery({ enabled: true });
    setupSaveMutation();
    setupDeleteMutation(mutate);

    render(<SiaPreferences />);
    fireEvent.click(screen.getByRole("button", { name: /delete my sia history/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, delete/i }));

    expect(mutate).toHaveBeenCalled();
    expect(siaHistoryDeleteSuccessToast).toHaveBeenCalled();
  });

  it("cancelling the dialog closes it without deleting", () => {
    const mutate = jest.fn();
    setupQuery({ enabled: true });
    setupSaveMutation();
    setupDeleteMutation(mutate);

    render(<SiaPreferences />);
    fireEvent.click(screen.getByRole("button", { name: /delete my sia history/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByText(/delete your entire sia conversation history/i)).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("calls the error toast on a failed delete", () => {
    const mutate = jest.fn((_arg, { onError }) => onError({ response: { data: { message: "nope" } } }));
    setupQuery({ enabled: true });
    setupSaveMutation();
    setupDeleteMutation(mutate);

    render(<SiaPreferences />);
    fireEvent.click(screen.getByRole("button", { name: /delete my sia history/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, delete/i }));

    expect(siaHistoryDeleteErrorToast).toHaveBeenCalledWith({ message: "nope" });
  });
});
