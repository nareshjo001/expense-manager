// DAT-004 -- Data Export screen. Same hook-mocking convention as
// NotificationPreferences.test.js -- mock the query/mutation hooks
// directly rather than standing up a real QueryClientProvider, since this
// component's own logic (what it renders, what it submits, how it reacts
// to the mutation's result) is the thing under test.
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DataExport from "./DataExport";
import { useExportRequestsQuery } from "../../hooks/queries/useExportRequestsQuery";
import { useCreateExportMutation } from "../../hooks/mutations/useCreateExportMutation";
import { useDeleteExportMutation } from "../../hooks/mutations/useDeleteExportMutation";
import { downloadExportFile } from "../../api/exportApi";
import {
  exportQueuedToast,
  exportDownloadReadyToast,
  exportCreateErrorToast,
  exportDeleteSuccessToast,
  exportDeleteErrorToast,
} from "../alertsEffects/toastMessages";

jest.mock("../../hooks/queries/useExportRequestsQuery", () => ({
  useExportRequestsQuery: jest.fn(),
}));
jest.mock("../../hooks/mutations/useCreateExportMutation", () => ({
  useCreateExportMutation: jest.fn(),
}));
jest.mock("../../hooks/mutations/useDeleteExportMutation", () => ({
  useDeleteExportMutation: jest.fn(),
}));
jest.mock("../../api/exportApi", () => ({
  downloadExportFile: jest.fn(),
}));
jest.mock("../alertsEffects/toastMessages", () => ({
  exportQueuedToast: jest.fn(),
  exportDownloadReadyToast: jest.fn(),
  exportCreateErrorToast: jest.fn(),
  exportDeleteSuccessToast: jest.fn(),
  exportDeleteErrorToast: jest.fn(),
}));

function setupQuery(data, overrides = {}) {
  useExportRequestsQuery.mockReturnValue({
    isLoading: false,
    isError: false,
    data: data ? { success: true, data } : undefined,
    refetch: jest.fn(),
    ...overrides,
  });
}

function setupCreateMutation(mutate = jest.fn()) {
  useCreateExportMutation.mockReturnValue({ mutate, isPending: false });
  return mutate;
}

function setupDeleteMutation(mutate = jest.fn()) {
  useDeleteExportMutation.mockReturnValue({ mutate, isPending: false });
  return mutate;
}

function sampleRequests() {
  return [
    {
      id: "1",
      domain: "expenses",
      format: "csv",
      status: "queued",
      rowCount: null,
      fileName: null,
      dateFrom: "2026-10-01",
      dateTo: "2026-10-25",
      createdAt: "2026-09-01T10:00:00.000Z",
      expiresAt: null,
      downloadUrl: null,
      downloadToken: null,
    },
    {
      id: "2",
      domain: "income",
      format: "json",
      status: "ready",
      rowCount: 120,
      fileName: "income.json",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
      createdAt: "2026-09-02T10:00:00.000Z",
      expiresAt: "2026-09-09T10:00:00.000Z",
      downloadUrl: "/api/export/download/token-2",
      downloadToken: "token-2",
    },
    {
      id: "3",
      domain: "budgets",
      format: "json",
      status: "failed",
      rowCount: null,
      fileName: null,
      dateFrom: null,
      dateTo: null,
      createdAt: "2026-09-03T10:00:00.000Z",
      expiresAt: null,
      downloadUrl: null,
      downloadToken: null,
    },
  ];
}

beforeAll(() => {
  window.URL.createObjectURL = jest.fn(() => "blob:mock-url");
  window.URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("DataExport -- form", () => {
  it("renders every domain and format option", () => {
    setupQuery([]);
    setupCreateMutation();
    setupDeleteMutation();

    render(<DataExport />);

    ["Expenses", "Income", "Budgets", "All"].forEach((label) => {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    });
    expect(screen.getByRole("option", { name: "CSV" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "JSON" })).toBeInTheDocument();
  });

  it("disables CSV and forces the format back to JSON once domain is All", () => {
    setupQuery([]);
    setupCreateMutation();
    setupDeleteMutation();

    render(<DataExport />);

    fireEvent.change(screen.getByLabelText(/^data$/i), { target: { value: "all" } });

    expect(screen.getByRole("option", { name: "CSV" })).toBeDisabled();
    expect(screen.getByLabelText(/^format$/i)).toHaveValue("json");
  });

  it("hides the date range fields and shows an explanatory note when domain is Budgets", () => {
    setupQuery([]);
    setupCreateMutation();
    setupDeleteMutation();

    render(<DataExport />);

    expect(screen.getByLabelText(/start date/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^data$/i), { target: { value: "budgets" } });

    expect(screen.queryByLabelText(/start date/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/end date/i)).not.toBeInTheDocument();
    expect(screen.getByText(/date range doesn't apply to budgets/i)).toBeInTheDocument();
  });

  it("prevents submission and toasts MISSING_DATES if dates are missing for non-budgets domain", () => {
    const mutate = setupCreateMutation();
    setupDeleteMutation();
    setupQuery([]);

    render(<DataExport />);

    fireEvent.change(screen.getByLabelText(/^data$/i), { target: { value: "expenses" } });
    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    expect(mutate).not.toHaveBeenCalled();
    expect(exportCreateErrorToast).toHaveBeenCalledWith({ errorCode: "MISSING_DATES" });
  });

  it("prevents submission and toasts INVALID_DATE_RANGE if startDate is after endDate", () => {
    const mutate = setupCreateMutation();
    setupDeleteMutation();
    setupQuery([]);

    render(<DataExport />);

    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-02-01" } });
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    expect(mutate).not.toHaveBeenCalled();
    expect(exportCreateErrorToast).toHaveBeenCalledWith({ errorCode: "INVALID_DATE_RANGE" });
  });

  it("submits the mutation with the selected domain/format/date range", () => {
    const mutate = setupCreateMutation();
    setupDeleteMutation();
    setupQuery([]);

    render(<DataExport />);

    fireEvent.change(screen.getByLabelText(/^data$/i), { target: { value: "income" } });
    fireEvent.change(screen.getByLabelText(/^format$/i), { target: { value: "json" } });
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: "2026-01-31" } });
    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    expect(mutate).toHaveBeenCalledWith(
      { domain: "income", format: "json", dateFrom: "2026-01-01", dateTo: "2026-01-31" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );
  });

  it("does not send a date range when domain is Budgets", () => {
    const mutate = setupCreateMutation();
    setupDeleteMutation();
    setupQuery([]);

    render(<DataExport />);

    fireEvent.change(screen.getByLabelText(/^data$/i), { target: { value: "budgets" } });
    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    expect(mutate).toHaveBeenCalledWith(
      { domain: "budgets", format: "csv" },
      expect.any(Object)
    );
  });

  it("toasts a queued message when the mutation resolves with a queued result", () => {
    let capturedOnSuccess;
    const mutate = jest.fn((_payload, { onSuccess }) => {
      capturedOnSuccess = onSuccess;
    });
    setupCreateMutation(mutate);
    setupDeleteMutation();
    setupQuery([]);

    render(<DataExport />);
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: "2026-01-31" } });
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    capturedOnSuccess({ file: false });

    expect(exportQueuedToast).toHaveBeenCalled();
    expect(exportDownloadReadyToast).not.toHaveBeenCalled();
  });

  it("toasts a download-ready message when the mutation resolves with a file", () => {
    let capturedOnSuccess;
    const mutate = jest.fn((_payload, { onSuccess }) => {
      capturedOnSuccess = onSuccess;
    });
    setupCreateMutation(mutate);
    setupDeleteMutation();
    setupQuery([]);

    render(<DataExport />);
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: "2026-01-31" } });
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    capturedOnSuccess({ file: true, filename: "expenses.csv" });

    expect(exportDownloadReadyToast).toHaveBeenCalledWith("expenses.csv");
    expect(exportQueuedToast).not.toHaveBeenCalled();
  });

  it("toasts a friendly error mapped from the response's errorCode on a failed creation", () => {
    let capturedOnError;
    const mutate = jest.fn((_payload, { onError }) => {
      capturedOnError = onError;
    });
    setupCreateMutation(mutate);
    setupDeleteMutation();
    setupQuery([]);

    render(<DataExport />);
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/end date/i), { target: { value: "2026-01-31" } });
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    capturedOnError({ response: { data: { errorCode: "TOO_MANY_ROWS" } } });

    expect(exportCreateErrorToast).toHaveBeenCalledWith({ errorCode: "TOO_MANY_ROWS" });
  });
});

describe("DataExport -- past exports list", () => {
  it("shows the loading state while the query is in flight", () => {
    setupQuery(null, { isLoading: true });
    setupCreateMutation();
    setupDeleteMutation();

    render(<DataExport />);

    expect(screen.getByText(/loading your past exports/i)).toBeInTheDocument();
  });

  it("shows the error state with a working retry button", () => {
    const refetch = jest.fn();
    setupQuery(null, { isError: true, refetch });
    setupCreateMutation();
    setupDeleteMutation();

    render(<DataExport />);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows the empty state when there are no past exports", () => {
    setupQuery([]);
    setupCreateMutation();
    setupDeleteMutation();

    render(<DataExport />);

    expect(screen.getByText(/no exports yet/i)).toBeInTheDocument();
  });

  it("renders each request with its domain/format, dates, and status badge inside scrollable container", () => {
    setupQuery(sampleRequests());
    setupCreateMutation();
    setupDeleteMutation();

    const { container } = render(<DataExport />);

    expect(screen.getByText(/expenses \(csv\)/i)).toBeInTheDocument();
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByText(/income \(json\)/i)).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText(/budgets \(json\)/i)).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();

    // Check dates rendered
    expect(screen.getByText("01 Oct 2026")).toBeInTheDocument();
    expect(screen.getByText("25 Oct 2026")).toBeInTheDocument();

    // Check scroll container exists
    expect(container.querySelector(".data-export-list-container")).toBeInTheDocument();
  });

  it("opens the actions menu on clicking the 3-dots button", () => {
    setupQuery(sampleRequests());
    setupCreateMutation();
    setupDeleteMutation();

    render(<DataExport />);

    const menuTriggers = screen.getAllByRole("button", { name: /export actions/i });
    expect(menuTriggers).toHaveLength(3);

    // Open ready request's menu (second item)
    fireEvent.click(menuTriggers[1]);

    expect(screen.getByRole("menuitem", { name: /download/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /delete/i })).toBeInTheDocument();
  });

  it("opens the dropdown upward on top to prevent clipping in scroll container", () => {
    setupQuery(sampleRequests());
    setupCreateMutation();
    setupDeleteMutation();

    render(<DataExport />);

    const menuTriggers = screen.getAllByRole("button", { name: /export actions/i });
    fireEvent.click(menuTriggers[0]);

    expect(document.body.querySelector(".data-export-menu-dropdown--up")).toBeInTheDocument();
  });

  it("ensures only one menu can be open at a time and closes on scroll", () => {
    setupQuery(sampleRequests());
    setupCreateMutation();
    setupDeleteMutation();

    render(<DataExport />);

    const menuTriggers = screen.getAllByRole("button", { name: /export actions/i });
    fireEvent.click(menuTriggers[0]);
    expect(document.body.querySelectorAll(".data-export-menu-dropdown")).toHaveLength(1);

    // Clicking second trigger switches menu, still exactly 1 open
    fireEvent.click(menuTriggers[1]);
    expect(document.body.querySelectorAll(".data-export-menu-dropdown")).toHaveLength(1);

    // Scrolling closes the menu
    fireEvent.scroll(window);
    expect(document.body.querySelectorAll(".data-export-menu-dropdown")).toHaveLength(0);
  });

  it("shows only delete (no download) in actions menu for queued or failed request", () => {
    setupQuery(sampleRequests());
    setupCreateMutation();
    setupDeleteMutation();

    render(<DataExport />);

    const menuTriggers = screen.getAllByRole("button", { name: /export actions/i });

    // Open queued request's menu (first item)
    fireEvent.click(menuTriggers[0]);

    expect(screen.queryByRole("menuitem", { name: /download/i })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /delete/i })).toBeInTheDocument();
  });

  it("triggers on-demand download and toast when clicking Download", async () => {
    setupQuery(sampleRequests());
    setupCreateMutation();
    setupDeleteMutation();

    downloadExportFile.mockResolvedValueOnce({
      blob: new Blob(["test-data"], { type: "application/json" }),
      filename: "income-export.json",
    });

    render(<DataExport />);

    const menuTriggers = screen.getAllByRole("button", { name: /export actions/i });
    fireEvent.click(menuTriggers[1]);

    const downloadBtn = screen.getByRole("menuitem", { name: /download/i });
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      expect(downloadExportFile).toHaveBeenCalledWith("token-2");
      expect(exportDownloadReadyToast).toHaveBeenCalledWith("income-export.json");
    });
  });

  it("triggers delete mutation and toast when clicking Delete", () => {
    let capturedOnSuccess;
    const mutate = jest.fn((id, { onSuccess }) => {
      capturedOnSuccess = onSuccess;
    });
    setupQuery(sampleRequests());
    setupCreateMutation();
    setupDeleteMutation(mutate);

    render(<DataExport />);

    const menuTriggers = screen.getAllByRole("button", { name: /export actions/i });
    fireEvent.click(menuTriggers[0]);

    const deleteBtn = screen.getByRole("menuitem", { name: /delete/i });
    fireEvent.click(deleteBtn);

    expect(mutate).toHaveBeenCalledWith("1", expect.objectContaining({ onSuccess: expect.any(Function) }));
    capturedOnSuccess();
    expect(exportDeleteSuccessToast).toHaveBeenCalled();
  });

  it("closes the open menu on Escape key press", () => {
    setupQuery(sampleRequests());
    setupCreateMutation();
    setupDeleteMutation();

    render(<DataExport />);

    const menuTriggers = screen.getAllByRole("button", { name: /export actions/i });
    fireEvent.click(menuTriggers[1]);
    expect(screen.getByRole("menuitem", { name: /download/i })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menuitem", { name: /download/i })).not.toBeInTheDocument();
  });
});
