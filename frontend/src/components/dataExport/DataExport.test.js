// DAT-004 -- Data Export screen. Same hook-mocking convention as
// NotificationPreferences.test.js -- mock the query/mutation hooks
// directly rather than standing up a real QueryClientProvider, since this
// component's own logic (what it renders, what it submits, how it reacts
// to the mutation's result) is the thing under test.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import DataExport from "./DataExport";
import { useExportRequestsQuery } from "../../hooks/queries/useExportRequestsQuery";
import { useCreateExportMutation } from "../../hooks/mutations/useCreateExportMutation";
import {
  exportQueuedToast,
  exportDownloadReadyToast,
  exportCreateErrorToast,
} from "../alertsEffects/toastMessages";

jest.mock("../../hooks/queries/useExportRequestsQuery", () => ({
  useExportRequestsQuery: jest.fn(),
}));
jest.mock("../../hooks/mutations/useCreateExportMutation", () => ({
  useCreateExportMutation: jest.fn(),
}));
jest.mock("../alertsEffects/toastMessages", () => ({
  exportQueuedToast: jest.fn(),
  exportDownloadReadyToast: jest.fn(),
  exportCreateErrorToast: jest.fn(),
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

function setupMutation(mutate = jest.fn()) {
  useCreateExportMutation.mockReturnValue({ mutate, isPending: false });
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
      createdAt: "2026-09-01T10:00:00.000Z",
      expiresAt: null,
      downloadUrl: null,
    },
    {
      id: "2",
      domain: "income",
      format: "json",
      status: "ready",
      rowCount: 120,
      fileName: "income.json",
      createdAt: "2026-09-02T10:00:00.000Z",
      expiresAt: "2026-09-09T10:00:00.000Z",
      downloadUrl: "/api/export/download/token-2",
    },
    {
      id: "3",
      domain: "budgets",
      format: "json",
      status: "failed",
      rowCount: null,
      fileName: null,
      createdAt: "2026-09-03T10:00:00.000Z",
      expiresAt: null,
      downloadUrl: null,
    },
  ];
}

afterEach(() => {
  jest.clearAllMocks();
});

describe("DataExport -- form", () => {
  it("renders every domain and format option", () => {
    setupQuery([]);
    setupMutation();

    render(<DataExport />);

    ["Expenses", "Income", "Budgets", "All"].forEach((label) => {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    });
    expect(screen.getByRole("option", { name: "CSV" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "JSON" })).toBeInTheDocument();
  });

  it("disables CSV and forces the format back to JSON once domain is All", () => {
    setupQuery([]);
    setupMutation();

    render(<DataExport />);

    fireEvent.change(screen.getByLabelText(/^data$/i), { target: { value: "all" } });

    expect(screen.getByRole("option", { name: "CSV" })).toBeDisabled();
    expect(screen.getByLabelText(/^format$/i)).toHaveValue("json");
  });

  it("hides the date range fields and shows an explanatory note when domain is Budgets", () => {
    setupQuery([]);
    setupMutation();

    render(<DataExport />);

    expect(screen.getByLabelText(/from \(optional\)/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^data$/i), { target: { value: "budgets" } });

    expect(screen.queryByLabelText(/from \(optional\)/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/to \(optional\)/i)).not.toBeInTheDocument();
    expect(screen.getByText(/date range doesn't apply to budgets/i)).toBeInTheDocument();
  });

  it("submits the mutation with the selected domain/format/date range", () => {
    const mutate = setupMutation();
    setupQuery([]);

    render(<DataExport />);

    fireEvent.change(screen.getByLabelText(/^data$/i), { target: { value: "income" } });
    fireEvent.change(screen.getByLabelText(/^format$/i), { target: { value: "json" } });
    fireEvent.change(screen.getByLabelText(/from \(optional\)/i), { target: { value: "2026-01-01" } });
    fireEvent.change(screen.getByLabelText(/to \(optional\)/i), { target: { value: "2026-01-31" } });
    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    expect(mutate).toHaveBeenCalledWith(
      { domain: "income", format: "json", dateFrom: "2026-01-01", dateTo: "2026-01-31" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );
  });

  it("does not send a date range when domain is Budgets", () => {
    const mutate = setupMutation();
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
    setupMutation(mutate);
    setupQuery([]);

    render(<DataExport />);
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
    setupMutation(mutate);
    setupQuery([]);

    render(<DataExport />);
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
    setupMutation(mutate);
    setupQuery([]);

    render(<DataExport />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    capturedOnError({ response: { data: { errorCode: "TOO_MANY_ROWS" } } });

    expect(exportCreateErrorToast).toHaveBeenCalledWith({ errorCode: "TOO_MANY_ROWS" });
  });
});

describe("DataExport -- past exports list", () => {
  it("shows the loading state while the query is in flight", () => {
    setupQuery(null, { isLoading: true });
    setupMutation();

    render(<DataExport />);

    expect(screen.getByText(/loading your past exports/i)).toBeInTheDocument();
  });

  it("shows the error state with a working retry button", () => {
    const refetch = jest.fn();
    setupQuery(null, { isError: true, refetch });
    setupMutation();

    render(<DataExport />);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows the empty state when there are no past exports", () => {
    setupQuery([]);
    setupMutation();

    render(<DataExport />);

    expect(screen.getByText(/no exports yet/i)).toBeInTheDocument();
  });

  it("renders each request with its domain/format and status badge", () => {
    setupQuery(sampleRequests());
    setupMutation();

    render(<DataExport />);

    expect(screen.getByText(/expenses \(csv\)/i)).toBeInTheDocument();
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByText(/income \(json\)/i)).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByText(/budgets \(json\)/i)).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("shows a download link only for the ready request, pointing at its downloadUrl", () => {
    setupQuery(sampleRequests());
    setupMutation();

    render(<DataExport />);

    const links = screen.getAllByRole("link", { name: /download/i });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "/api/export/download/token-2");
  });
});
