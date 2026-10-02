import React, { useState, useEffect } from "react";
import { format as formatDate, parseISO } from "date-fns";
import "./ReceiptInbox.css";

import QueryState from "../common/QueryState";
import ReceiptDetail from "./ReceiptDetail";
import { useReceiptsQuery } from "../../hooks/queries/useReceiptsQuery";
import { getReceiptImageBlob } from "../../api/receiptsApi";
import { formatMoney } from "../../utils/money";
import { FaSearch, FaChevronRight } from "react-icons/fa";

const REVIEW_STATUS_LABEL = {
  needs_review: "Needs review",
  reviewed: "Reviewed",
};

function formatUploadedAt(value) {
  if (!value) return null;
  try {
    return formatDate(parseISO(value), "d MMM yyyy, HH:mm");
  } catch {
    return null;
  }
}

// OCR-004 -- fetches one receipt's image through the authenticated axios
// instance and exposes it as a local object URL.
function ReceiptThumbnail({ imageUrl, alt }) {
  const [objectUrl, setObjectUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setObjectUrl(null);
    setFailed(false);

    if (!imageUrl) return undefined;

    const controller = new AbortController();
    let localUrl = null;
    let cancelled = false;

    getReceiptImageBlob(imageUrl, controller.signal)
      .then((blob) => {
        if (cancelled) return;
        localUrl = URL.createObjectURL(blob);
        setObjectUrl(localUrl);
      })
      .catch((error) => {
        if (cancelled || error.code === "ERR_CANCELED") return;
        setFailed(true);
      });

    return () => {
      cancelled = true;
      controller.abort();
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [imageUrl]);

  if (!imageUrl || failed) {
    return <div className="receipt-thumbnail receipt-thumbnail-fallback" aria-hidden="true" />;
  }

  if (!objectUrl) {
    return <div className="receipt-thumbnail receipt-thumbnail-loading" aria-hidden="true" />;
  }

  return <img className="receipt-thumbnail" src={objectUrl} alt={alt} />;
}

// OCR-004 -- the receipt inbox: every receipt persisted from a bill upload,
// with its review status, an OCR summary, filter/search surface, and receipt content list.
const ReceiptInbox = () => {
  const [reviewStatusFilter, setReviewStatusFilter] = useState("");
  const [linkedFilter, setLinkedFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedReceiptId, setSelectedReceiptId] = useState(null);

  const linked = linkedFilter === "" ? undefined : linkedFilter === "linked";

  const receiptsQuery = useReceiptsQuery({
    reviewStatus: reviewStatusFilter || undefined,
    linked,
  });

  const receipts = receiptsQuery.data?.success ? receiptsQuery.data.data : [];

  const filteredReceipts = receipts.filter((receipt) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.trim().toLowerCase();
    const fields = receipt.extractedFields || {};
    const nameMatch = fields.expenseName?.toLowerCase().includes(term);
    const amountMatch = String(fields.expenseAmount || "").includes(term);
    const categoryMatch = fields.expenseCategory?.toLowerCase().includes(term);
    const dateMatch = fields.expenseDate?.toLowerCase().includes(term);
    return Boolean(nameMatch || amountMatch || categoryMatch || dateMatch);
  });

  if (selectedReceiptId) {
    return (
      <div className="receipt-inbox-page">
        <ReceiptDetail receiptId={selectedReceiptId} onBack={() => setSelectedReceiptId(null)} />
      </div>
    );
  }

  return (
    <div className="receipt-inbox-page">
      <div className="receipt-inbox-header">
        <div className="receipt-inbox-title-wrapper">
          <span className="receipt-inbox-accent-bar" aria-hidden="true" />
          <h2 className="receipt-inbox-heading">Receipt Inbox</h2>
        </div>
        <p className="receipt-inbox-subheading">
          Every receipt you upload while adding an expense is saved here, so you can review it later,
          fix anything the scanner misread, and link it to the expense it belongs to.
        </p>
      </div>

      <div className="receipt-inbox-filters-card">
        <div className="receipt-filter-group">
          <div className="receipt-filter-field">
            <label htmlFor="receipt-filter-status">Review status</label>
            <div className="receipt-select-wrapper">
              <select
                id="receipt-filter-status"
                value={reviewStatusFilter}
                onChange={(e) => setReviewStatusFilter(e.target.value)}
              >
                <option value="">All</option>
                <option value="needs_review">Needs review</option>
                <option value="reviewed">Reviewed</option>
              </select>
            </div>
          </div>

          <div className="receipt-filter-divider" aria-hidden="true" />

          <div className="receipt-filter-field">
            <label htmlFor="receipt-filter-linked">Linked</label>
            <div className="receipt-select-wrapper">
              <select
                id="receipt-filter-linked"
                value={linkedFilter}
                onChange={(e) => setLinkedFilter(e.target.value)}
              >
                <option value="">All</option>
                <option value="linked">Linked</option>
                <option value="unlinked">Unlinked</option>
              </select>
            </div>
          </div>
        </div>

        <div className="receipt-search-wrapper">
          <FaSearch className="receipt-search-icon" aria-hidden="true" />
          <input
            id="receipt-search-input"
            type="text"
            className="receipt-search-input"
            placeholder="Search receipts, merchant, amount..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="Search receipts"
          />
        </div>
      </div>

      <div className="receipt-inbox-content-card">
        <QueryState
          isLoading={receiptsQuery.isLoading}
          isError={receiptsQuery.isError}
          isEmpty={!receiptsQuery.isLoading && !receiptsQuery.isError && receipts.length === 0}
          onRetry={receiptsQuery.refetch}
          loadingLabel="Loading your receipts..."
          errorLabel="We couldn't load your receipts. Please try again."
          emptyLabel="No receipts yet."
          emptyHint="Receipts you upload while adding an expense will show up here."
        >
          {searchTerm.trim() && filteredReceipts.length === 0 ? (
            <div className="receipt-inbox-no-search-results">
              <p className="receipt-no-results-title">No matching receipts</p>
              <p className="receipt-no-results-hint">
                No receipts found matching "{searchTerm}". Try a different keyword or clear your search.
              </p>
              <button
                type="button"
                className="receipt-clear-search-btn"
                onClick={() => setSearchTerm("")}
              >
                Clear search
              </button>
            </div>
          ) : (
            <ul className="receipt-inbox-list">
              {filteredReceipts.map((receipt) => {
                const fields = receipt.extractedFields || {};

                return (
                  <li key={receipt.id} className="receipt-inbox-item">
                    <button
                      type="button"
                      className="receipt-inbox-item-btn"
                      onClick={() => setSelectedReceiptId(receipt.id)}
                    >
                      <div className="receipt-inbox-item-left">
                        <ReceiptThumbnail imageUrl={receipt.imageUrl} alt="Receipt thumbnail" />

                        <div className="receipt-inbox-item-text">
                          <div className="receipt-inbox-item-title-row">
                            <span className="receipt-inbox-item-name">
                              {fields.expenseName || "Unnamed receipt"}
                            </span>
                            <span className={`receipt-badge receipt-badge--${receipt.reviewStatus}`}>
                              <span className="receipt-badge-dot" aria-hidden="true" />
                              {REVIEW_STATUS_LABEL[receipt.reviewStatus] || receipt.reviewStatus}
                            </span>
                            {receipt.linkedExpenseId && (
                              <span className="receipt-badge receipt-badge--linked">
                                <span className="receipt-badge-dot" aria-hidden="true" />
                                Linked
                              </span>
                            )}
                          </div>

                          <div className="receipt-inbox-item-meta-row">
                            <span className="receipt-inbox-item-amount">
                              {formatMoney(fields.expenseAmount)}
                            </span>
                            {fields.expenseDate && (
                              <>
                                <span className="receipt-inbox-item-divider" aria-hidden="true">·</span>
                                <span className="receipt-inbox-item-date">{fields.expenseDate}</span>
                              </>
                            )}
                            <span className="receipt-inbox-item-divider" aria-hidden="true">·</span>
                            <span className="receipt-inbox-item-meta">
                              Uploaded {formatUploadedAt(receipt.uploadedAt) || "—"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="receipt-inbox-item-right" aria-hidden="true">
                        <FaChevronRight className="receipt-item-chevron" />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </QueryState>
      </div>
    </div>
  );
};

export default ReceiptInbox;
