import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { format as formatDate, parseISO } from "date-fns";
import { FiUpload, FiCalendar, FiMoreHorizontal, FiDownload, FiTrash2 } from "react-icons/fi";
import {
  FaDatabase,
  FaFileAlt,
  FaRegCalendarAlt,
  FaChevronDown,
} from "react-icons/fa";
import "../expensesHandling/AddExpense.css";
import "./DataExport.css";

import QueryState from "../common/QueryState";
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

function formatFilterDate(value) {
  if (!value) return "--";
  try {
    const date = typeof value === "string" && value.length === 10
      ? parseISO(value)
      : new Date(value);
    if (isNaN(date.getTime())) return "--";
    return formatDate(date, "dd MMM yyyy");
  } catch {
    return "--";
  }
}

const DataExport = () => {
  const requestsQuery = useExportRequestsQuery();
  const createMutation = useCreateExportMutation();
  const deleteMutation = useDeleteExportMutation();

  const [domain, setDomain] = useState("expenses");
  const [formatValue, setFormatValue] = useState("csv");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [openMenuId, setOpenMenuId] = useState(null);
  const [menuCoords, setMenuCoords] = useState(null);
  const [downloadingId, setDownloadingId] = useState(null);

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

  // Close open action menu on outside click, window/container scroll, or escape key
  useEffect(() => {
    if (!openMenuId) return;

    const handleScroll = () => {
      setOpenMenuId(null);
      setMenuCoords(null);
    };

    const handleDocumentClick = (event) => {
      if (
        event.target.closest(".data-export-menu-dropdown") ||
        event.target.closest(".data-export-menu-trigger")
      ) {
        return;
      }
      setOpenMenuId(null);
      setMenuCoords(null);
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpenMenuId(null);
        setMenuCoords(null);
      }
    };

    window.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", handleScroll);
    document.addEventListener("mousedown", handleDocumentClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
      document.removeEventListener("mousedown", handleDocumentClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenuId]);

  const requests = requestsQuery.data?.success ? requestsQuery.data.data : [];
  const activeRequest = requests.find((r) => r.id === openMenuId);

  const handleToggleMenu = (e, request) => {
    e.stopPropagation();
    if (openMenuId === request.id) {
      setOpenMenuId(null);
      setMenuCoords(null);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      // Keep menu on top (above the trigger button) when opened.
      // If trigger is very close to top of viewport (< 90px), fall back to opening downward.
      const shouldOpenUpward = rect.top === 0 || rect.top >= 90;
      setOpenMenuId(request.id);
      setMenuCoords({
        openUpward: shouldOpenUpward,
        top: shouldOpenUpward ? undefined : rect.bottom + 6,
        bottom: shouldOpenUpward ? window.innerHeight - rect.top + 6 : undefined,
        right: window.innerWidth - rect.right,
      });
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!isBudgetsDomain) {
      if (!dateFrom || !dateTo) {
        exportCreateErrorToast({ errorCode: "MISSING_DATES" });
        return;
      }
      if (new Date(dateFrom) > new Date(dateTo)) {
        exportCreateErrorToast({ errorCode: "INVALID_DATE_RANGE" });
        return;
      }
    }

    const payload = {
      domain,
      format: formatValue,
      // Contract: dateFrom/dateTo are mandatory for expenses/income/all,
      // but not applicable/ignored for domain "budgets".
      ...(!isBudgetsDomain ? { dateFrom, dateTo } : {}),
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

  const handleDownload = async (request) => {
    setOpenMenuId(null);
    setMenuCoords(null);
    const token =
      request.downloadToken ||
      (request.downloadUrl ? request.downloadUrl.split("/").pop() : null);
    if (!token) return;

    try {
      setDownloadingId(request.id);
      const result = await downloadExportFile(token);
      const url = window.URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename || `${request.domain}-export.${request.format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      exportDownloadReadyToast(result.filename);
    } catch {
      // ignore download failure or error handled by axios interceptor
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = (request) => {
    setOpenMenuId(null);
    setMenuCoords(null);
    deleteMutation.mutate(request.id, {
      onSuccess: () => {
        exportDeleteSuccessToast();
      },
      onError: (error) => {
        exportDeleteErrorToast(error?.response?.data);
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
                  <label htmlFor="data-export-date-from">
                    Start date <span className="data-export-required-star" aria-hidden="true">*</span>
                  </label>
                  <div className="data-export-input-wrapper">
                    <span className="data-export-input-icon" aria-hidden="true">
                      <FaRegCalendarAlt />
                    </span>
                    <input
                      id="data-export-date-from"
                      type="date"
                      value={dateFrom}
                      required={!isBudgetsDomain}
                      onChange={(e) => setDateFrom(e.target.value)}
                    />
                  </div>
                </div>

                <div className="data-export-field field data-export-field--to">
                  <label htmlFor="data-export-date-to">
                    End date <span className="data-export-required-star" aria-hidden="true">*</span>
                  </label>
                  <div className="data-export-input-wrapper">
                    <span className="data-export-input-icon" aria-hidden="true">
                      <FaRegCalendarAlt />
                    </span>
                    <input
                      id="data-export-date-to"
                      type="date"
                      value={dateTo}
                      required={!isBudgetsDomain}
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
          <div className="data-export-list-container">
            <ul className="data-export-list">
              {requests.map((request) => (
                <li key={request.id} className="data-export-item">
                  {/* Left: Format icon badge & Title/subtitle */}
                  <div className="data-export-item-left">
                    <div className="data-export-format-badge" aria-hidden="true">
                      <svg
                        className="data-export-format-badge-icon"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M4 4C4 2.89543 4.89543 2 6 2H14.5858C15.1163 2 15.6251 2.21071 16 2.58579L19.4142 6C19.7893 6.37486 20 6.88371 20 7.41421V20C20 21.1046 19.1046 22 18 22H6C4.89543 22 4 21.1046 4 20V4Z"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M14 2V7C14 7.55228 14.4477 8 15 8H20"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span className="data-export-format-badge-text">
                        {(request.format || "csv").toUpperCase()}
                      </span>
                    </div>

                    <div className="data-export-item-details">
                      <h4 className="data-export-item-title">
                        {DOMAIN_LABEL[request.domain] || request.domain} (
                        {FORMAT_LABEL[request.format] || request.format})
                      </h4>
                      <p className="data-export-item-subtitle">
                        Requested {formatRequestDate(request.createdAt) || "--"}
                        {typeof request.rowCount === "number" ? ` · ${request.rowCount} rows` : ""}
                      </p>
                    </div>
                  </div>

                  {/* Middle: Date columns */}
                  <div className="data-export-item-dates">
                    <div className="data-export-date-group">
                      <span className="data-export-date-label">Start date</span>
                      <div className="data-export-date-value">
                        <FiCalendar className="data-export-date-icon" aria-hidden="true" />
                        <span>{formatFilterDate(request.dateFrom)}</span>
                      </div>
                    </div>
                    <div className="data-export-date-group">
                      <span className="data-export-date-label">End date</span>
                      <div className="data-export-date-value">
                        <FiCalendar className="data-export-date-icon" aria-hidden="true" />
                        <span>{formatFilterDate(request.dateTo)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Status pill and Action Menu */}
                  <div className="data-export-item-actions-col">
                    <span className={`data-export-status-pill data-export-status-pill--${request.status}`}>
                      <span className="data-export-status-dot" aria-hidden="true" />
                      <span>{STATUS_LABEL[request.status] || request.status}</span>
                    </span>

                    <div className="data-export-actions-wrapper">
                      <button
                        type="button"
                        className="data-export-menu-trigger"
                        aria-label="Export actions"
                        aria-haspopup="menu"
                        aria-expanded={openMenuId === request.id}
                        onClick={(e) => handleToggleMenu(e, request)}
                      >
                        <FiMoreHorizontal aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </QueryState>
      </section>

      {/* Render the single active dropdown menu via Portal into document.body */}
      {activeRequest && menuCoords && typeof document !== "undefined" && createPortal(
        <div
          className={`data-export-menu-dropdown ${
            menuCoords.openUpward ? "data-export-menu-dropdown--up" : ""
          }`}
          role="menu"
          style={{
            position: "fixed",
            ...(menuCoords.top !== undefined
              ? { top: `${menuCoords.top}px` }
              : { bottom: `${menuCoords.bottom}px` }),
            right: `${menuCoords.right}px`,
            zIndex: 99999,
          }}
        >
          {activeRequest.status === "ready" && (
            <button
              type="button"
              className="data-export-menu-item"
              role="menuitem"
              onClick={() => handleDownload(activeRequest)}
              disabled={downloadingId === activeRequest.id}
            >
              <FiDownload className="data-export-menu-item-icon" aria-hidden="true" />
              <span>
                {downloadingId === activeRequest.id ? "Downloading..." : "Download"}
              </span>
            </button>
          )}
          <button
            type="button"
            className="data-export-menu-item data-export-menu-item--delete"
            role="menuitem"
            onClick={() => handleDelete(activeRequest)}
            disabled={deleteMutation.isPending}
          >
            <FiTrash2 className="data-export-menu-item-icon" aria-hidden="true" />
            <span>Delete</span>
          </button>
        </div>,
        document.body
      )}
    </div>
  );
};

export default DataExport;
