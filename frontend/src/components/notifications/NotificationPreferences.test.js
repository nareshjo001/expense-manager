// NOT-003-T05/T07 -- notification-preferences settings screen. Same
// hook-mocking pattern as RecurringManagement.test.js -- mock the query/
// mutation hooks directly rather than standing up a real
// QueryClientProvider, since this component's own logic (what it renders,
// what it saves) is the thing under test.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import NotificationPreferences from "./NotificationPreferences";
import { useNotificationPreferencesQuery } from "../../hooks/queries/useNotificationPreferencesQuery";
import { useSaveNotificationPreferencesMutation } from "../../hooks/mutations/useSaveNotificationPreferencesMutation";
import {
  notificationPreferencesSaveSuccessToast,
  notificationPreferencesSaveErrorToast,
} from "../alertsEffects/toastMessages";

jest.mock("../../hooks/queries/useNotificationPreferencesQuery", () => ({
  useNotificationPreferencesQuery: jest.fn(),
}));
jest.mock("../../hooks/mutations/useSaveNotificationPreferencesMutation", () => ({
  useSaveNotificationPreferencesMutation: jest.fn(),
}));
jest.mock("../alertsEffects/toastMessages", () => ({
  notificationPreferencesSaveSuccessToast: jest.fn(),
  notificationPreferencesSaveErrorToast: jest.fn(),
}));

function payload(overrides = {}) {
  return {
    types: {
      "recurring-expense": { enabled: true, preview: "device" },
      "recurring-expense-ended": { enabled: true, preview: "device" },
    },
    quietHours: { enabled: false, start: "22:00", end: "07:00", timeZone: null },
    typeMeta: {
      "recurring-expense": { label: "Recurring expense logged", description: "When one is added." },
      "recurring-expense-ended": { label: "Recurring expense ended", description: "When one ends." },
    },
    updatedAt: null,
    ...overrides,
  };
}

function setupQuery(data, overrides = {}) {
  useNotificationPreferencesQuery.mockReturnValue({
    isLoading: false,
    isError: false,
    data: data ? { success: true, data } : undefined,
    refetch: jest.fn(),
    ...overrides,
  });
}

function setupMutation(mutate = jest.fn()) {
  useSaveNotificationPreferencesMutation.mockReturnValue({ mutate, isPending: false });
  return mutate;
}

afterEach(() => {
  jest.clearAllMocks();
});

describe("NotificationPreferences -- loading/error states", () => {
  it("shows the loading state while the query is in flight", () => {
    setupQuery(null, { isLoading: true });
    setupMutation();

    render(<NotificationPreferences />);

    expect(screen.getByText(/loading your notification preferences/i)).toBeInTheDocument();
  });

  it("shows the error state with a working retry button", () => {
    const refetch = jest.fn();
    setupQuery(null, { isError: true, refetch });
    setupMutation();

    render(<NotificationPreferences />);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe("NotificationPreferences -- rendering registered types", () => {
  it("renders a toggle and preview select per registered type, using typeMeta labels", () => {
    setupQuery(payload());
    setupMutation();

    render(<NotificationPreferences />);

    expect(screen.getByText("Recurring expense logged")).toBeInTheDocument();
    expect(screen.getByText("Recurring expense ended")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(3); // 2 types + quiet-hours toggle
  });

  it("disables the preview select for a type that is turned off", () => {
    setupQuery(payload({
      types: { "recurring-expense": { enabled: false, preview: "device" } },
      typeMeta: { "recurring-expense": { label: "Recurring expense logged" } },
    }));
    setupMutation();

    render(<NotificationPreferences />);

    const [toggle] = screen.getAllByRole("checkbox");
    expect(toggle).not.toBeChecked();
    expect(screen.getByLabelText(/preview/i)).toBeDisabled();
  });
});

describe("NotificationPreferences -- editing and saving", () => {
  it("toggling a type off and saving submits the change", () => {
    const mutate = setupMutation();
    setupQuery(payload({
      types: { "recurring-expense": { enabled: true, preview: "device" } },
      typeMeta: { "recurring-expense": { label: "Recurring expense logged" } },
    }));

    render(<NotificationPreferences />);

    fireEvent.click(screen.getByRole("checkbox", { name: /recurring expense logged/i }));
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        types: expect.objectContaining({
          "recurring-expense": expect.objectContaining({ enabled: false }),
        }),
      }),
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );
  });

  it("changing a type's preview mode and saving submits the new preview", () => {
    const mutate = setupMutation();
    setupQuery(payload({
      types: { "recurring-expense": { enabled: true, preview: "device" } },
      typeMeta: { "recurring-expense": { label: "Recurring expense logged" } },
    }));

    render(<NotificationPreferences />);

    fireEvent.change(screen.getByLabelText(/preview/i), { target: { value: "generic" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        types: expect.objectContaining({
          "recurring-expense": expect.objectContaining({ preview: "generic" }),
        }),
      }),
      expect.any(Object)
    );
  });

  it("enabling quiet hours reveals start/end/time-zone fields, and saving submits them", () => {
    const mutate = setupMutation();
    setupQuery(payload());

    render(<NotificationPreferences />);

    expect(screen.queryByLabelText(/^start$/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /don't send notifications during quiet hours/i }));

    expect(screen.getByLabelText(/^start$/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^start$/i), { target: { value: "23:00" } });
    fireEvent.change(screen.getByLabelText(/^end$/i), { target: { value: "06:00" } });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        quietHours: expect.objectContaining({ enabled: true, start: "23:00", end: "06:00", timeZone: null }),
      }),
      expect.any(Object)
    );
  });

  it("calls the success toast on a successful save", () => {
    let savedOnSuccess;
    const mutate = jest.fn((_payload, { onSuccess }) => { savedOnSuccess = onSuccess; });
    setupMutation(mutate);
    setupQuery(payload());

    render(<NotificationPreferences />);
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    savedOnSuccess();

    expect(notificationPreferencesSaveSuccessToast).toHaveBeenCalled();
  });

  it("calls the error toast on a failed save", () => {
    let savedOnError;
    const mutate = jest.fn((_payload, { onError }) => { savedOnError = onError; });
    setupMutation(mutate);
    setupQuery(payload());

    render(<NotificationPreferences />);
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    savedOnError({ response: { data: { message: "nope" } } });

    expect(notificationPreferencesSaveErrorToast).toHaveBeenCalledWith({ message: "nope" });
  });
});
