import React, { useState, useEffect } from "react";
import { format as formatDate, parseISO } from "date-fns";
import "../expensesHandling/AddExpense.css";
import "./ReceiptInbox.css";

import QueryState from "../common/QueryState";
import ReceiptDetail from "./ReceiptDetail";
import { useReceiptsQuery } from "../../hooks/queries/useReceiptsQuery";
import { getReceiptImageBlob } from "../../api/receiptsApi";
import { formatMoney } from "../../utils/money";

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
// instance (see receiptsApi.js's getReceiptImageBlob header comment for why
// a plain <img src> can't be used here) and exposes it as a local object
// URL, the same createObjectURL/revokeObjectURL pairing BillUpload.js's own
// file preview already uses. Kept local to this file -- both this
// thumbnail and ReceiptDetail.js's full-size image need the identical
// fetch-blob-then-object-URL dance, but neither file is allowed to reach
// for a shared hook file outside this feature's scope, so each owns its
// own small copy.
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

// OCR-004 -- the receipt inbox: every receipt persisted from a bill upload
// (see BillUpload.js/AddExpense.js, unchanged by this feature -- a future
// task wires a fresh upload's "view in inbox" link into this screen), with
// its review status, an OCR summary, and a filter by review status/linked
// state. Clicking a receipt swaps this list for ReceiptDetail inline --
// same parent-owned "which child view is showing" toggle AddExpense.js
// already uses for BillUpload, rather than a second nested route.
const ReceiptInbox = () => {
  const [reviewStatusFilter, setReviewStatusFilter] = useState("");
  const [linkedFilter, setLinkedFilter] = useState("");
  const [selectedReceiptId, setSelectedReceiptId] = useState(null);

  const linked = linkedFilter === "" ? undefined : linkedFilter === "linked";

  const receiptsQuery = useReceiptsQuery({
    reviewStatus: reviewStatusFilter || undefined,
    linked,
  });

  const receipts = receiptsQuery.data?.success ? receiptsQuery.data.data : [];

  if (selectedReceiptId) {
    return (
      <div className="add-page receipt-inbox-page">
        <ReceiptDetail receiptId={selectedReceiptId} onBack={() => setSelectedReceiptId(null)} />
      </div>
    );
  }

  return (
    <div className="add-page receipt-inbox-page">
      <h2 className="receipt-inbox-heading">Receipt Inbox</h2>
      <p className="receipt-inbox-subheading">
        Every receipt you upload while adding an expense is saved here, so you can review it later,
        fix anything the scanner misread, and link it to the expense it belongs to.
      </p>

      <div className="receipt-inbox-filters">
        <div className="field">
          <label htmlFor="receipt-filter-status">Review status</label>
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

        <div className="field">
          <label htmlFor="receipt-filter-linked">Linked</label>
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
        <ul className="receipt-inbox-list">
          {receipts.map((receipt) => {
            const fields = receipt.extractedFields || {};

            return (
              <li key={receipt.id} className="receipt-inbox-item">
                <button
                  type="button"
                  className="receipt-inbox-item-btn"
                  onClick={() => setSelectedReceiptId(receipt.id)}
                >
                  <ReceiptThumbnail imageUrl={receipt.imageUrl} alt="Receipt thumbnail" />

                  <div className="receipt-inbox-item-text">
                    <div className="receipt-inbox-item-title-row">
                      <span className="receipt-inbox-item-name">
                        {fields.expenseName || "Unnamed receipt"}
                      </span>
                      <span className={`receipt-badge receipt-badge--${receipt.reviewStatus}`}>
                        {REVIEW_STATUS_LABEL[receipt.reviewStatus] || receipt.reviewStatus}
                      </span>
                      {receipt.linkedExpenseId && (
                        <span className="receipt-badge receipt-badge--linked">Linked</span>
                      )}
                    </div>

                    <span className="receipt-inbox-item-meta">
                      {formatMoney(fields.expenseAmount)}
                      {fields.expenseDate ? ` · ${fields.expenseDate}` : ""}
                    </span>

                    <span className="receipt-inbox-item-meta">
                      Uploaded {formatUploadedAt(receipt.uploadedAt) || "—"}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </QueryState>
    </div>
  );
};

export default ReceiptInbox;
