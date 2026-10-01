import React, { useEffect, useState } from "react";
import { format as formatDate, parseISO } from "date-fns";
import { FiUpload } from "react-icons/fi";
import {
  FaDatabase,
  FaFileAlt,
  FaRegCalendarAlt,
  FaChevronDown,
  FaDownload,
} from "react-icons/fa";
import "../expensesHandling/AddExpense.css";
import "./DataExport.css";

import QueryState from "../common/QueryState";
import { useExportRequestsQuery } from "../../hooks/queries/useExportRequestsQuery";
import { useCreateExportMutation } from "../../hooks/mutations/useCreateExportMutation";
import {
  exportQueuedToast,
  exportDownloadReadyToast,
  exportCreateErrorToast,
} from "../alertsEffects/toastMessages";

// DAT-004 -- lets a user export their expenses/income/budgets as a CSV or
// JSON file. A small export downloads immediately (see
// useCreateExportMutation's own comment on how that Blob path works); a
// large one is queued and generated in the background, and shows up --
// then updates its own status -- in the list below via
// useExportRequestsQuery's polling. Same settings-screen shape as
// NotificationPreferences.js: QueryState for the list, hook-owned mutation/
// query, toasts on the actions this screen itself takes.
const DOMAIN_LABEL = {
  expenses: "Expenses",
  income: "Income",
  budgets: "Budgets",
  all: "All",
};

const FORMAT_LABEL = {
  csv: "CSV",
  json: "JSON",
};

const STATUS_LABEL = {
  queued: "Queued",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
  expired: "Expired",
};

function formatRequestDate(value) {
  if (!value) return null;
  try {
    return formatDate(parseISO(value), "d MMM yyyy, HH:mm");
  } catch {
    return null;
  }
}

const DataExport = () => {
  const requestsQuery = useExportRequestsQuery();
  const createMutation = useCreateExportMutation();

  const [domain, setDomain] = useState("expenses");
  const [formatValue, setFormatValue] = useState("csv");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const isAllDomain = domain === "all";
  const isBudgetsDomain = domain === "budgets";

  // Contract: domain "all" only supports format "json" -- reject/disable
  // that combination client-side too, don't rely on the server alone. This
  // keeps the selected format valid the instant the domain changes to (or
  // away from) "all", rather than only catching an invalid combination at
  // submit time.
  useEffect(() => {
    if (isAllDomain && formatValue !== "json") {
      setFormatValue("json");
    }
  }, [isAllDomain, formatValue]);

  const requests = requestsQuery.data?.success ? requestsQuery.data.data : [];

  const handleSubmit = (e) => {
    e.preventDefault();

    const payload = {
      domain,
      format: formatValue,
      // Contract: dateFrom/dateTo are not applicable/ignored for domain
      // "budgets" -- never sent for it here, regardless of what was typed
      // into the (hidden, for that domain) date fields before switching.
      ...(!isBudgetsDomain && dateFrom ? { dateFrom } : {}),
      ...(!isBudgetsDomain && dateTo ? { dateTo } : {}),
    };

    createMutation.mutate(payload, {
      onSuccess: (result) => {
        if (result?.file) {
          exportDownloadReadyToast(result.filename);
        } else {
          exportQueuedToast();
        }
      },
      onError: (error) => {
        exportCreateErrorToast(error.response?.data);
      },
    });
  };

  return (
    <div className="add-page data-export-page">
      <div className="data-export-card data-export-config-card">
        <div className="data-export-header">
          <div className="data-export-title-wrapper">
            <span className="data-export-accent-bar" aria-hidden="true" />
            <h2 className="data-export-heading">Data Export</h2>
          </div>
          <p className="data-export-subheading">
            Export your expenses, income, or budgets as a CSV or JSON file. Small exports download
            right away; larger ones are prepared in the background and appear below once ready.
          </p>
        </div>

        <form className="data-export-form" onSubmit={handleSubmit}>
          <div className="data-export-form-grid">
            {/* Row 1, Col 1: Data */}
            <div className="data-export-field field data-export-field--data">
              <label htmlFor="data-export-domain">Data</label>
              <div className="data-export-input-wrapper">
                <span className="data-export-input-icon" aria-hidden="true">
                  <FaDatabase />
                </span>
                <select
                  id="data-export-domain"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                >
                  {Object.entries(DOMAIN_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <span className="data-export-select-arrow" aria-hidden="true">
                  <FaChevronDown />
                </span>
              </div>
            </div>

            {/* Row 1, Col 2: Format */}
            <div className="data-export-field field data-export-field--format">
              <label htmlFor="data-export-format">Format</label>
              <div className="data-export-input-wrapper">
                <span className="data-export-input-icon" aria-hidden="true">
                  <FaFileAlt />
                </span>
                <select
                  id="data-export-format"
                  value={formatValue}
                  onChange={(e) => setFormatValue(e.target.value)}
                >
                  <option value="csv" disabled={isAllDomain}>
                    CSV
                  </option>
                  <option value="json">JSON</option>
                </select>
                <span className="data-export-select-arrow" aria-hidden="true">
                  <FaChevronDown />
                </span>
              </div>
              {isAllDomain && (
                <p className="data-export-hint">Exporting all data is only available as JSON.</p>
              )}
            </div>

            {/* Row 1, Col 3: Spacer on desktop */}
            <div className="data-export-grid-spacer" aria-hidden="true" />

            {/* Row 2: Date filters or budgets hint */}
            {isBudgetsDomain ? (
              <div className="data-export-budgets-hint-wrapper">
                <p className="data-export-hint">
                  Date range doesn't apply to budgets -- every budget is included in this export.
                </p>
              </div>
            ) : (
              <>
                <div className="data-export-field field data-export-field--from">
                  <label htmlFor="data-export-date-from">From (optional)</label>
                  <div className="data-export-input-wrapper">
                    <span className="data-export-input-icon" aria-hidden="true">
                      <FaRegCalendarAlt />
                    </span>
                    <input
                      id="data-export-date-from"
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                    />
                  </div>
                </div>

                <div className="data-export-field field data-export-field--to">
                  <label htmlFor="data-export-date-to">To (optional)</label>
                  <div className="data-export-input-wrapper">
                    <span className="data-export-input-icon" aria-hidden="true">
                      <FaRegCalendarAlt />
                    </span>
                    <input
                      id="data-export-date-to"
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}

            {/* Row 2, Col 3: Export button */}
            <div
              className={`data-export-btn-wrapper ${
                isBudgetsDomain ? "data-export-btn-wrapper--budgets" : ""
              }`}
            >
              <button
                type="submit"
                className="submit-btn data-export-submit-btn"
                disabled={createMutation.isPending}
              >
                <FiUpload className="data-export-btn-icon" aria-hidden="true" />
                <span>{createMutation.isPending ? "Exporting..." : "Export"}</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      <section className="data-export-card data-export-history-card data-export-history">
        <div className="data-export-header data-export-history-header">
          <div className="data-export-title-wrapper">
            <span className="data-export-accent-bar" aria-hidden="true" />
            <h3 className="data-export-history-heading">Past exports</h3>
          </div>
        </div>

        <QueryState
          isLoading={requestsQuery.isLoading}
          isError={requestsQuery.isError}
          isEmpty={!requestsQuery.isLoading && !requestsQuery.isError && requests.length === 0}
          onRetry={requestsQuery.refetch}
          loadingLabel="Loading your past exports..."
          errorLabel="We couldn't load your past exports. Please try again."
          emptyLabel="No exports yet."
          emptyHint="Requests you create above will show up here."
        >
          <ul className="data-export-list">
            {requests.map((request) => (
              <li key={request.id} className="data-export-item">
                <div className="data-export-item-text">
                  <div className="data-export-item-title-row">
                    <span className="data-export-item-name">
                      {DOMAIN_LABEL[request.domain] || request.domain} (
                      {FORMAT_LABEL[request.format] || request.format})
                    </span>
                    <span className={`data-export-badge data-export-badge--${request.status}`}>
                      {STATUS_LABEL[request.status] || request.status}
                    </span>
                  </div>
                  <span className="data-export-item-meta">
                    Requested {formatRequestDate(request.createdAt) || "--"}
                    {typeof request.rowCount === "number" ? ` · ${request.rowCount} rows` : ""}
                  </span>
                </div>

                {request.status === "ready" && request.downloadUrl && (
                  <a
                    className="data-export-download-link"
                    href={request.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <FaDownload className="data-export-download-icon" aria-hidden="true" />
                    <span>Download</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        </QueryState>
      </section>
    </div>
  );
};

export default DataExport;
