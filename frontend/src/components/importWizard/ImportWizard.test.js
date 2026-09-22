// IMP-001 -- CSV import wizard. Same hook-mocking convention as
// ReceiptDetail.test.js -- mock every query/mutation hook directly and
// drive each one's `mutate`/`onSuccess`/`onError` by hand, rather than
// wiring up a real TanStack Query client.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import ImportWizard from "./ImportWizard";

// react-router-dom isn't resolvable under this repo's Jest 27 CJS
// resolution (its package.json `main` points at a file the installed
// package doesn't ship) -- same `virtual: true` workaround
// App.startup.test.js already uses for the same module, here just mocking
// the one export ImportWizard.js actually uses (`Link`, rendered as a
// plain anchor) instead of the whole router.
jest.mock(
  "react-router-dom",
  () => {
    const ReactLib = require("react");
    return {
      Link: ({ to, children, ...props }) => ReactLib.createElement("a", { href: to, ...props }, children),
    };
  },
  { virtual: true }
);
import { useImportHeadersMutation } from "../../hooks/mutations/useImportHeadersMutation";
import { useCreateImportSessionMutation } from "../../hooks/mutations/useCreateImportSessionMutation";
import { useImportSessionQuery } from "../../hooks/queries/useImportSessionQuery";
import { useDecideImportRowMutation } from "../../hooks/mutations/useDecideImportRowMutation";
import { useCommitImportSessionMutation } from "../../hooks/mutations/useCommitImportSessionMutation";
import {
  importSessionCreatedToast,
  importSessionCreateErrorToast,
  importCommitSuccessToast,
  importCommitErrorToast,
} from "../alertsEffects/toastMessages";

jest.mock("../../hooks/mutations/useImportHeadersMutation", () => ({
  useImportHeadersMutation: jest.fn(),
}));
jest.mock("../../hooks/mutations/useCreateImportSessionMutation", () => ({
  useCreateImportSessionMutation: jest.fn(),
}));
jest.mock("../../hooks/queries/useImportSessionQuery", () => ({
  useImportSessionQuery: jest.fn(),
}));
jest.mock("../../hooks/mutations/useDecideImportRowMutation", () => ({
  useDecideImportRowMutation: jest.fn(),
}));
jest.mock("../../hooks/mutations/useCommitImportSessionMutation", () => ({
  useCommitImportSessionMutation: jest.fn(),
}));
jest.mock("../alertsEffects/toastMessages", () => ({
  importSessionCreatedToast: jest.fn(),
  importSessionCreateErrorToast: jest.fn(),
  importCommitSuccessToast: jest.fn(),
  importCommitErrorToast: jest.fn(),
}));

const csvFile = () => new File(["date,amount,merchant\n2026-01-01,10,Store"], "expenses.csv", { type: "text/csv" });

function renderWizard() {
  render(<ImportWizard />);
}

function selectCsvFile() {
  fireEvent.change(screen.getByLabelText(/select a csv file/i), { target: { files: [csvFile()] } });
}

function noOpSessionQuery() {
  useImportSessionQuery.mockReturnValue({
    isLoading: false,
    isError: false,
    data: undefined,
    refetch: jest.fn(),
  });
}

beforeEach(() => {
  useCreateImportSessionMutation.mockReturnValue({ mutate: jest.fn(), isPending: false });
  useDecideImportRowMutation.mockReturnValue({ mutate: jest.fn(), isPending: false });
  useCommitImportSessionMutation.mockReturnValue({ mutate: jest.fn(), isPending: false });
  noOpSessionQuery();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("ImportWizard -- upload step", () => {
  it("moves to mapping with the suggested columns pre-filled on a successful headers fetch", () => {
    const mutate = jest.fn((_payload, { onSuccess }) =>
      onSuccess({
        success: true,
        headerRow: ["Date", "Amount", "Merchant", "Category"],
        suggestedMapping: { date: "Date", amount: "Amount", merchant: "Merchant", category: "Category" },
      })
    );
    useImportHeadersMutation.mockReturnValue({ mutate, isPending: false });

    renderWizard();
    selectCsvFile();

    expect(mutate).toHaveBeenCalled();
    expect(screen.getByText(/match each column/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^date$/i).value).toBe("Date");
    expect(screen.getByLabelText(/^amount$/i).value).toBe("Amount");
    expect(screen.getByLabelText(/^merchant$/i).value).toBe("Merchant");
    expect(screen.getByLabelText(/category/i).value).toBe("Category");
  });

  it("shows a plain-language message for a mapped errorCode and stays on the upload step", () => {
    const mutate = jest.fn((_payload, { onError }) =>
      onError({ response: { data: { errorCode: "IMPORT_TOO_MANY_ROWS" } } })
    );
    useImportHeadersMutation.mockReturnValue({ mutate, isPending: false });

    renderWizard();
    selectCsvFile();

    expect(screen.getByRole("alert")).toHaveTextContent(/too many rows -- the limit is 5,000/i);
    expect(screen.getByLabelText(/select a csv file/i)).toBeInTheDocument();
    expect(screen.queryByText(/match each column/i)).not.toBeInTheDocument();
  });
});

describe("ImportWizard -- mapping step", () => {
  it("disables Preview until date, amount and merchant are all mapped", () => {
    const mutate = jest.fn((_payload, { onSuccess }) =>
      onSuccess({
        success: true,
        headerRow: ["Date", "Amount", "Merchant"],
        suggestedMapping: { date: null, amount: null, merchant: null, category: null },
      })
    );
    useImportHeadersMutation.mockReturnValue({ mutate, isPending: false });

    renderWizard();
    selectCsvFile();

    const previewBtn = screen.getByRole("button", { name: /^preview$/i });
    expect(previewBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^date$/i), { target: { value: "Date" } });
    fireEvent.change(screen.getByLabelText(/^amount$/i), { target: { value: "Amount" } });
    expect(previewBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^merchant$/i), { target: { value: "Merchant" } });
    expect(previewBtn).not.toBeDisabled();
  });
});

// Drives the wizard from upload through to the preview step, then swaps in
// the given rows as the session-detail query's data, same
// "mock the hooks, don't wire up a real client" posture as the rest of
// this file.
function goToPreviewWithRows(rows) {
  const headersMutate = jest.fn((_payload, { onSuccess }) =>
    onSuccess({
      success: true,
      headerRow: ["Date", "Amount", "Merchant", "Category"],
      suggestedMapping: { date: "Date", amount: "Amount", merchant: "Merchant", category: "Category" },
    })
  );
  useImportHeadersMutation.mockReturnValue({ mutate: headersMutate, isPending: false });

  const createMutate = jest.fn((_payload, { onSuccess }) =>
    onSuccess({ success: true, data: { id: "sess1", rows } })
  );
  useCreateImportSessionMutation.mockReturnValue({ mutate: createMutate, isPending: false });

  useImportSessionQuery.mockReturnValue({
    isLoading: false,
    isError: false,
    data: { success: true, data: { id: "sess1", status: "previewing", rows } },
    refetch: jest.fn(),
  });

  renderWizard();
  selectCsvFile();
  fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));
}

function makeRow(overrides = {}) {
  return {
    rowIndex: 0,
    raw: ["2026-01-01", "10", "Store"],
    mapped: { expenseName: "Store", expenseAmount: 10, expenseDate: "2026-01-01", expenseCategory: null },
    validationErrors: [],
    duplicateCandidateExpenseId: null,
    suggestedCategory: null,
    decision: "pending",
    committedExpenseId: null,
    ...overrides,
  };
}

describe("ImportWizard -- preview step", () => {
  it("renders validation errors, a duplicate badge and a suggestion chip per row", () => {
    const rows = [
      makeRow({ rowIndex: 0 }),
      makeRow({ rowIndex: 1, validationErrors: ["MISSING_AMOUNT"], mapped: { ...makeRow().mapped, expenseAmount: null } }),
      makeRow({ rowIndex: 2, duplicateCandidateExpenseId: "exp-9" }),
      makeRow({ rowIndex: 3, suggestedCategory: "Groceries" }),
    ];

    goToPreviewWithRows(rows);

    expect(screen.getByText("Missing amount")).toBeInTheDocument();
    expect(screen.getByText(/possible duplicate of an existing expense/i)).toBeInTheDocument();
    expect(screen.getByText(/suggested: groceries/i)).toBeInTheDocument();
    expect(screen.getByText("1 with errors")).toBeInTheDocument();
    expect(screen.getByText("4 pending")).toBeInTheDocument();
    expect(importSessionCreatedToast).toHaveBeenCalledWith(4);
  });

  it("toasts a mapped error and stays on the mapping step when session creation fails", () => {
    const headersMutate = jest.fn((_payload, { onSuccess }) =>
      onSuccess({
        success: true,
        headerRow: ["Date", "Amount", "Merchant"],
        suggestedMapping: { date: "Date", amount: "Amount", merchant: "Merchant", category: null },
      })
    );
    useImportHeadersMutation.mockReturnValue({ mutate: headersMutate, isPending: false });

    const createMutate = jest.fn((_payload, { onError }) =>
      onError({ response: { data: { errorCode: "INVALID_MAPPING" } } })
    );
    useCreateImportSessionMutation.mockReturnValue({ mutate: createMutate, isPending: false });

    renderWizard();
    selectCsvFile();
    fireEvent.click(screen.getByRole("button", { name: /^preview$/i }));

    expect(importSessionCreateErrorToast).toHaveBeenCalledWith({ errorCode: "INVALID_MAPPING" });
    expect(screen.getByText(/match each column/i)).toBeInTheDocument();
  });

  it("disables Accept for a row with validation errors", () => {
    const rows = [makeRow({ rowIndex: 0, validationErrors: ["MISSING_AMOUNT"] })];

    goToPreviewWithRows(rows);

    expect(screen.getByRole("button", { name: /^accept$/i })).toBeDisabled();
  });

  it("shows Commit 0 rows, disabled, when nothing is accepted", () => {
    const rows = [makeRow({ rowIndex: 0, decision: "pending" })];

    goToPreviewWithRows(rows);

    const commitBtn = screen.getByRole("button", { name: /commit 0 rows/i });
    expect(commitBtn).toBeDisabled();
  });

  it("counts only accepted, error-free rows toward the commit total", () => {
    const rows = [
      makeRow({ rowIndex: 0, decision: "accept" }),
      makeRow({ rowIndex: 1, decision: "accept", validationErrors: ["INVALID_AMOUNT"] }),
      makeRow({ rowIndex: 2, decision: "skip" }),
    ];

    goToPreviewWithRows(rows);

    const commitBtn = screen.getByRole("button", { name: /commit 1 row$/i });
    expect(commitBtn).not.toBeDisabled();
  });

  it("moves to the done step and shows the committed/skipped counts on a successful commit", () => {
    const rows = [makeRow({ rowIndex: 0, decision: "accept" })];
    const commitMutate = jest.fn((_id, { onSuccess }) =>
      onSuccess({ success: true, data: { status: "committed", committedCount: 1, skippedCount: 0 } })
    );
    useCommitImportSessionMutation.mockReturnValue({ mutate: commitMutate, isPending: false });

    goToPreviewWithRows(rows);
    fireEvent.click(screen.getByRole("button", { name: /commit 1 row$/i }));

    expect(importCommitSuccessToast).toHaveBeenCalledWith(1);
    expect(screen.getByText(/1 expense added, 0 skipped/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /import another file/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view expenses/i })).toBeInTheDocument();
  });

  it("toasts a mapped error and stays on the preview step when commit fails", () => {
    const rows = [makeRow({ rowIndex: 0, decision: "accept" })];
    const commitMutate = jest.fn((_id, { onError }) =>
      onError({ response: { data: { errorCode: "SESSION_EXPIRED" } } })
    );
    useCommitImportSessionMutation.mockReturnValue({ mutate: commitMutate, isPending: false });

    goToPreviewWithRows(rows);
    fireEvent.click(screen.getByRole("button", { name: /commit 1 row$/i }));

    expect(importCommitErrorToast).toHaveBeenCalledWith({ errorCode: "SESSION_EXPIRED" });
    expect(screen.getByRole("button", { name: /commit 1 row$/i })).toBeInTheDocument();
  });
});
