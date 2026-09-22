import React, { useState } from "react";
import { Link } from "react-router-dom";
import "./ImportWizard.css";

import QueryState from "../common/QueryState";
import { useImportHeadersMutation } from "../../hooks/mutations/useImportHeadersMutation";
import { useCreateImportSessionMutation } from "../../hooks/mutations/useCreateImportSessionMutation";
import { useImportSessionQuery } from "../../hooks/queries/useImportSessionQuery";
import { useDecideImportRowMutation } from "../../hooks/mutations/useDecideImportRowMutation";
import { useCommitImportSessionMutation } from "../../hooks/mutations/useCommitImportSessionMutation";
import { formatMoney } from "../../utils/money";
import {
  importSessionCreatedToast,
  importSessionCreateErrorToast,
  importCommitSuccessToast,
  importCommitErrorToast,
} from "../alertsEffects/toastMessages";

// IMP-001 -- CSV bulk import wizard: upload -> map columns -> preview
// every row (with validation errors, a duplicate-expense warning, and a
// suggested category) -> accept/skip each row -> commit. One component
// with an internal step state ("upload" | "mapping" | "preview" | "done"),
// same single-big-component posture ReceiptDetail.js already uses for an
// analogous multi-part receipt-inbox view, rather than splitting each step
// into its own file.

// Plain-language messages for the contract's file-level errorCodes,
// shown inline on the upload step. Kept as its own copy (not imported
// from toastMessages.js, which keeps its own private IMPORT_ERROR_MESSAGES
// for the session-create toast) -- same errorCode -> message lookup shape
// RECEIPT_LINK_ERROR_MESSAGES/EXPORT_ERROR_MESSAGES use elsewhere, just
// scoped to this component instead of exported.
const IMPORT_FILE_ERROR_MESSAGES = {
  IMPORT_EMPTY_FILE: "That file is empty.",
  IMPORT_TOO_MANY_ROWS: "This file has too many rows -- the limit is 5,000.",
  IMPORT_MALFORMED_ROW: "This file has a row that couldn't be read. Please check its formatting.",
  FILE_TOO_LARGE: "This file is too large to upload.",
};

// Plain-language labels for a preview row's validationErrors codes.
const ROW_ERROR_MESSAGES = {
  MISSING_DATE: "Missing date",
  INVALID_DATE: "Invalid date",
  MISSING_AMOUNT: "Missing amount",
  INVALID_AMOUNT: "Invalid amount",
  MISSING_MERCHANT: "Missing merchant name",
};

const MAPPING_FIELDS = [
  { key: "date", label: "Date", required: true },
  { key: "amount", label: "Amount", required: true },
  { key: "merchant", label: "Merchant", required: true },
  { key: "category", label: "Category", required: false },
];

const EMPTY_MAPPING = { date: "", amount: "", merchant: "", category: "" };

const ROW_DECISION_ERROR_FALLBACK = "Couldn't save this row's decision. Please try again.";

const ImportWizard = () => {
  const [step, setStep] = useState("upload");
  const [selectedFile, setSelectedFile] = useState(null);
  const [headerRow, setHeaderRow] = useState([]);
  const [mapping, setMapping] = useState(EMPTY_MAPPING);
  const [uploadError, setUploadError] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [rowActionError, setRowActionError] = useState(null);
  const [pendingRowIndex, setPendingRowIndex] = useState(null);
  const [committedSession, setCommittedSession] = useState(null);

  const headersMutation = useImportHeadersMutation();
  const createSessionMutation = useCreateImportSessionMutation();
  const sessionQuery = useImportSessionQuery(sessionId);
  const decideRowMutation = useDecideImportRowMutation();
  const commitMutation = useCommitImportSessionMutation();

  const session = sessionQuery.data?.success ? sessionQuery.data.data : null;
  const rows = session?.rows || [];

  const resetWizard = () => {
    setStep("upload");
    setSelectedFile(null);
    setHeaderRow([]);
    setMapping(EMPTY_MAPPING);
    setUploadError(null);
    setSessionId(null);
    setRowActionError(null);
    setPendingRowIndex(null);
    setCommittedSession(null);
  };

  // No separate "upload" button -- picking a file immediately previews its
  // headers, same "the file input's onChange itself is the action" shape
  // BillUpload.js's own handleFileChange uses for the client-side part of
  // its file selection (this one just also fires the network call, since
  // there's no local-only validation step worth gating it behind here).
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadError(null);
    setSelectedFile(file);

    headersMutation.mutate(
      { file },
      {
        onSuccess: (result) => {
          if (!result?.success) {
            setUploadError(result?.message || "Couldn't read this file. Please try again.");
            return;
          }

          const suggested = result.suggestedMapping || {};
          setHeaderRow(result.headerRow || []);
          setMapping({
            date: suggested.date || "",
            amount: suggested.amount || "",
            merchant: suggested.merchant || "",
            category: suggested.category || "",
          });
          setStep("mapping");
        },
        onError: (error) => {
          const data = error.response?.data || {};
          setUploadError(
            IMPORT_FILE_ERROR_MESSAGES[data.errorCode] || data.message || "Couldn't read this file. Please try again."
          );
        },
      }
    );
  };

  const handleMappingChange = (key, value) => {
    setMapping((prev) => ({ ...prev, [key]: value }));
  };

  const isMappingComplete = Boolean(mapping.date && mapping.amount && mapping.merchant);

  // Reuses the ORIGINAL File object kept in state from the upload step --
  // never re-prompts for upload, per the contract needing the file again
  // to create the session.
  const handlePreview = () => {
    if (!selectedFile || !isMappingComplete) return;

    createSessionMutation.mutate(
      {
        file: selectedFile,
        columnMapping: {
          date: mapping.date,
          amount: mapping.amount,
          merchant: mapping.merchant,
          category: mapping.category || null,
        },
      },
      {
        onSuccess: (result) => {
          if (!result?.success) return;
          setSessionId(result.data.id);
          importSessionCreatedToast(result.data.rows.length);
          setStep("preview");
        },
        onError: (error) => importSessionCreateErrorToast(error.response?.data),
      }
    );
  };

  // No success toast per row decision -- see toastMessages.js's own
  // comment on IMPORT_ERROR_MESSAGES for why (the row list's own state is
  // the feedback). A failure surfaces as an inline banner instead, next to
  // the row list it's about.
  const handleRowDecision = (rowIndex, decision) => {
    if (!sessionId) return;

    setRowActionError(null);
    setPendingRowIndex(rowIndex);

    decideRowMutation.mutate(
      { id: sessionId, rowIndex, decision },
      {
        onSuccess: () => setPendingRowIndex(null),
        onError: (error) => {
          setPendingRowIndex(null);
          setRowActionError(error.response?.data?.message || ROW_DECISION_ERROR_FALLBACK);
        },
      }
    );
  };

  const hasRowErrors = (row) => Array.isArray(row.validationErrors) && row.validationErrors.length > 0;

  const acceptedRows = rows.filter((row) => row.decision === "accept");
  const skippedRows = rows.filter((row) => row.decision === "skip");
  const pendingRows = rows.filter((row) => row.decision === "pending");
  const errorRows = rows.filter(hasRowErrors);
  const commitCount = rows.filter((row) => row.decision === "accept" && !hasRowErrors(row)).length;

  const handleCommit = () => {
    if (!sessionId || commitCount === 0) return;

    commitMutation.mutate(sessionId, {
      onSuccess: (result) => {
        if (!result?.success) return;
        setCommittedSession(result.data);
        importCommitSuccessToast(result.data.committedCount);
        setStep("done");
      },
      onError: (error) => importCommitErrorToast(error.response?.data),
    });
  };

  return (
    <div className="import-wizard">
      <div className="import-wizard-header">
        <h2>Import Expenses from CSV</h2>
        <ol className="import-wizard-steps" aria-label="Import steps">
          <li className={step === "upload" ? "active" : ""}>1. Upload</li>
          <li className={step === "mapping" ? "active" : ""}>2. Map columns</li>
          <li className={step === "preview" ? "active" : ""}>3. Preview</li>
          <li className={step === "done" ? "active" : ""}>4. Done</li>
        </ol>
      </div>

      {step === "upload" && (
        <div className="import-wizard-upload">
          <div className="import-field">
            <label htmlFor="import-file-input">Select a CSV file</label>
            <input
              id="import-file-input"
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              aria-describedby={uploadError ? "import-file-error" : undefined}
            />
          </div>

          {headersMutation.isPending && (
            <p className="import-wizard-hint" role="status">Reading this file…</p>
          )}

          {uploadError && (
            <p id="import-file-error" className="import-wizard-error" role="alert">
              {uploadError}
            </p>
          )}
        </div>
      )}

      {step === "mapping" && (
        <div className="import-wizard-mapping">
          <p className="import-wizard-hint">
            Match each column in your file to an expense field. We've pre-filled our best guess below.
          </p>

          {MAPPING_FIELDS.map(({ key, label, required }) => (
            <div className="import-field" key={key}>
              <label htmlFor={`import-map-${key}`}>
                {label}
                {required ? "" : " (optional)"}
              </label>
              <select
                id={`import-map-${key}`}
                value={mapping[key]}
                onChange={(e) => handleMappingChange(key, e.target.value)}
              >
                <option value="">{required ? "Choose a column" : "None"}</option>
                {headerRow.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </div>
          ))}

          <div className="import-wizard-actions">
            <button type="button" className="import-wizard-secondary-btn" onClick={resetWizard}>
              Start over
            </button>
            <button
              type="button"
              className="import-wizard-primary-btn"
              onClick={handlePreview}
              disabled={!isMappingComplete || createSessionMutation.isPending}
            >
              {createSessionMutation.isPending ? "Loading preview…" : "Preview"}
            </button>
          </div>
        </div>
      )}

      {step === "preview" && (
        <div className="import-wizard-preview">
          <QueryState
            isLoading={sessionQuery.isLoading}
            isError={sessionQuery.isError}
            isEmpty={!sessionQuery.isLoading && !sessionQuery.isError && !session}
            onRetry={sessionQuery.refetch}
            loadingLabel="Loading your preview…"
            errorLabel="We couldn't load this import's preview. Please try again."
            emptyLabel="This import session isn't available."
          >
            {session && (
              <>
                <div className="import-wizard-totals">
                  <span className="import-wizard-total import-wizard-total--accepted">
                    {acceptedRows.length} accepted
                  </span>
                  <span className="import-wizard-total import-wizard-total--skipped">
                    {skippedRows.length} skipped
                  </span>
                  <span className="import-wizard-total import-wizard-total--pending">
                    {pendingRows.length} pending
                  </span>
                  <span className="import-wizard-total import-wizard-total--errors">
                    {errorRows.length} with errors
                  </span>
                </div>

                {rowActionError && (
                  <p className="import-wizard-error" role="alert">{rowActionError}</p>
                )}

                <ul className="import-row-list">
                  {rows.map((row) => {
                    const rowHasErrors = hasRowErrors(row);
                    const mapped = row.mapped || {};
                    const isRowPending = pendingRowIndex === row.rowIndex && decideRowMutation.isPending;

                    return (
                      <li key={row.rowIndex} className={`import-row-item import-row-item--${row.decision}`}>
                        <div className="import-row-main">
                          <span className="import-row-name">{mapped.expenseName || "—"}</span>
                          <span className="import-row-meta">
                            {formatMoney(mapped.expenseAmount)}
                            {mapped.expenseDate ? ` · ${mapped.expenseDate}` : ""}
                            {mapped.expenseCategory ? ` · ${mapped.expenseCategory}` : ""}
                          </span>
                          <span className="import-row-raw">Raw: {(row.raw || []).join(" | ")}</span>
                        </div>

                        <div className="import-row-flags">
                          {row.duplicateCandidateExpenseId && (
                            <span className="import-row-badge import-row-badge--duplicate">
                              Possible duplicate of an existing expense
                            </span>
                          )}
                          {row.suggestedCategory && (
                            <span className="import-row-badge import-row-badge--suggestion">
                              Suggested: {row.suggestedCategory}
                            </span>
                          )}
                          {rowHasErrors && (
                            <ul className="import-row-errors">
                              {row.validationErrors.map((code) => (
                                <li key={code}>{ROW_ERROR_MESSAGES[code] || code}</li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div className="import-row-actions">
                          <button
                            type="button"
                            className="import-row-accept-btn"
                            onClick={() => handleRowDecision(row.rowIndex, "accept")}
                            disabled={rowHasErrors || isRowPending || row.decision === "accept"}
                            title={rowHasErrors ? "Fix this row's errors before accepting it" : undefined}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            className="import-row-skip-btn"
                            onClick={() => handleRowDecision(row.rowIndex, "skip")}
                            disabled={isRowPending || row.decision === "skip"}
                          >
                            Skip
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <div className="import-wizard-actions">
                  <button
                    type="button"
                    className="import-wizard-primary-btn"
                    onClick={handleCommit}
                    disabled={commitCount === 0 || commitMutation.isPending}
                  >
                    {commitMutation.isPending ? "Committing…" : `Commit ${commitCount} row${commitCount === 1 ? "" : "s"}`}
                  </button>
                </div>
              </>
            )}
          </QueryState>
        </div>
      )}

      {step === "done" && committedSession && (
        <div className="import-wizard-done">
          <p className="import-wizard-done-summary">
            {committedSession.committedCount} expense{committedSession.committedCount === 1 ? "" : "s"} added,{" "}
            {committedSession.skippedCount} skipped.
          </p>

          <div className="import-wizard-actions">
            <Link to="/" className="import-wizard-primary-btn import-wizard-link-btn">
              View Expenses
            </Link>
            <button type="button" className="import-wizard-secondary-btn" onClick={resetWizard}>
              Import another file
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImportWizard;
