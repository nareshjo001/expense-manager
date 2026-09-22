import React, { useState, useEffect } from "react";
import { format as formatDate, parseISO } from "date-fns";
import "../expensesHandling/AddExpense.css";
import "./ReceiptDetail.css";

import QueryState from "../common/QueryState";
import DeleteAlert from "../alertsEffects/DeleteAlert";
import { useReceiptDetailQuery } from "../../hooks/queries/useReceiptDetailQuery";
import { useReceiptDuplicatesQuery } from "../../hooks/queries/useReceiptDuplicatesQuery";
import { useLinkReceiptMutation } from "../../hooks/mutations/useLinkReceiptMutation";
import { useUnlinkReceiptMutation } from "../../hooks/mutations/useUnlinkReceiptMutation";
import { useMarkReceiptReviewedMutation } from "../../hooks/mutations/useMarkReceiptReviewedMutation";
import { useDeleteReceiptMutation } from "../../hooks/mutations/useDeleteReceiptMutation";
import { useRecordDuplicateDecisionMutation } from "../../hooks/mutations/useRecordDuplicateDecisionMutation";
import { getReceiptImageBlob } from "../../api/receiptsApi";
import { formatMoney } from "../../utils/money";
import {
  receiptLinkSuccessToast,
  receiptLinkErrorToast,
  receiptUnlinkSuccessToast,
  receiptUnlinkErrorToast,
  receiptReviewSuccessToast,
  receiptReviewErrorToast,
  receiptDeleteSuccessToast,
  receiptDeleteErrorToast,
  receiptDuplicateDecisionSuccessToast,
  receiptDuplicateDecisionErrorToast,
} from "../alertsEffects/toastMessages";

// OCR-003 -- rounds a receipt field's OCR confidence (0-100) for display, or
// returns null when there's nothing to show. Same helper AddExpense.js
// already defines for the identical fieldConfidence shape -- duplicated
// here (not imported from there) since AddExpense.js is explicitly out of
// scope for this feature and this component owns its own small copy.
const formatFieldConfidence = (value) => (typeof value === "number" ? Math.round(value) : null);

function formatTimestamp(value) {
  if (!value) return null;
  try {
    return formatDate(parseISO(value), "d MMM yyyy, HH:mm");
  } catch {
    return null;
  }
}

// Renders one field's confidence badge, matching AddExpense.js's own
// field-confidence markup/classes exactly (imported from AddExpense.css
// above) so a receipt looks the same way here as it does mid-upload on the
// Add Expense form, rather than inventing a second visual language for the
// identical fieldConfidence data.
function FieldConfidenceBadge({ value }) {
  const rounded = formatFieldConfidence(value);
  if (rounded === null) return null;

  return (
    <span
      className={`field-confidence${rounded < 60 ? " low" : ""}`}
      aria-label={`Receipt OCR confidence for this field: ${rounded}%`}
    >
      <span>Receipt confidence</span>
      <strong>· {rounded}%</strong>
    </span>
  );
}

// Same fetch-blob-through-axios-then-object-URL approach as
// ReceiptInbox.js's ReceiptThumbnail (see receiptsApi.js's
// getReceiptImageBlob header comment for why a plain <img src> can't
// authenticate this request) -- just rendered at full size here.
function ReceiptImage({ imageUrl }) {
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
    return (
      <div className="receipt-detail-image-fallback" role="status">
        {failed ? "Couldn't load this receipt's image." : "No image available."}
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div className="receipt-detail-image-loading" role="status" aria-live="polite">
        Loading image…
      </div>
    );
  }

  return <img className="receipt-detail-image" src={objectUrl} alt="Receipt" />;
}

// OCR-005 -- human-readable label for a duplicate candidate's reasonCode,
// same lookup-by-value shape RECEIPT_LINK_ERROR_MESSAGES in
// toastMessages.js uses for its own server-sent codes.
const DUPLICATE_REASON_LABELS = {
  EXACT_FILE_MATCH: "Same file already uploaded",
  PROBABLE_MERCHANT_DATE_AMOUNT: "Looks like the same purchase",
};

// Same fetch-blob-through-axios-then-object-URL approach as ReceiptImage
// above and ReceiptInbox.js's ReceiptThumbnail -- just sized down for a
// duplicate candidate's small preview. Duplicated here rather than shared
// as a hook, same posture ReceiptImage above already documents for why
// this file keeps its own copy instead of reaching into ReceiptInbox.js.
function ReceiptDuplicateThumbnail({ imageUrl, alt }) {
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
    return <div className="receipt-duplicate-thumbnail receipt-duplicate-thumbnail-fallback" aria-hidden="true" />;
  }

  if (!objectUrl) {
    return <div className="receipt-duplicate-thumbnail receipt-duplicate-thumbnail-loading" aria-hidden="true" />;
  }

  return <img className="receipt-duplicate-thumbnail" src={objectUrl} alt={alt} />;
}

// OCR-004 -- single receipt view: full-size image, extracted fields with
// per-field confidence, a correction form (only while reviewStatus is
// "needs_review"), link/unlink-to-expense controls, and a confirm-before-
// delete action. Rendered inline by ReceiptInbox.js in place of the list,
// not behind its own route.
const ReceiptDetail = ({ receiptId, onBack }) => {
  const receiptQuery = useReceiptDetailQuery(receiptId);
  const duplicatesQuery = useReceiptDuplicatesQuery(receiptId);
  const linkMutation = useLinkReceiptMutation();
  const unlinkMutation = useUnlinkReceiptMutation();
  const reviewMutation = useMarkReceiptReviewedMutation();
  const deleteMutation = useDeleteReceiptMutation();
  const duplicateDecisionMutation = useRecordDuplicateDecisionMutation();

  const receipt = receiptQuery.data?.success ? receiptQuery.data.data : null;
  const fields = receipt?.extractedFields || {};

  // OCR-005 -- possible duplicate candidates for this receipt. Only ever
  // acted on while duplicateStatus is still "unreviewed" -- see the
  // duplicateCandidates render-guard below -- so there's nothing to derive
  // here beyond the raw list.
  const duplicateCandidates = duplicatesQuery.data?.success ? duplicatesQuery.data.data : [];

  const [nameInput, setNameInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [dateInput, setDateInput] = useState("");
  const [expenseIdInput, setExpenseIdInput] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Syncs the correction form to the fields OCR actually extracted once a
  // receipt (re)loads -- keyed on the id rather than running on every
  // render, so a background refetch (e.g. after a link/unlink mutation
  // invalidates this same query) doesn't clobber text the user is still
  // mid-editing in the correction form below.
  useEffect(() => {
    if (!receipt) return;

    const loadedFields = receipt.extractedFields || {};
    setNameInput(loadedFields.expenseName || "");
    setAmountInput(typeof loadedFields.expenseAmount === "number" ? String(loadedFields.expenseAmount) : "");
    setDateInput(loadedFields.expenseDate || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt?.id]);

  if (!receiptId) return null;

  const handleCorrectionSubmit = (e) => {
    e.preventDefault();

    // Only sends what actually changed from what OCR extracted -- an
    // unmodified field isn't a "correction". An empty/undefined
    // `corrections` still marks the receipt reviewed (see
    // markReceiptReviewed's own header comment).
    const corrections = {};
    const originalName = fields.expenseName || "";
    const originalDate = fields.expenseDate || "";
    const originalAmount = fields.expenseAmount;

    const trimmedName = nameInput.trim();
    if (trimmedName !== originalName) {
      corrections.expenseName = trimmedName;
    }
    if (dateInput !== originalDate) {
      corrections.expenseDate = dateInput;
    }
    if (amountInput !== "") {
      const numericAmount = Number(amountInput);
      if (!Number.isNaN(numericAmount) && numericAmount !== originalAmount) {
        corrections.expenseAmount = numericAmount;
      }
    }

    reviewMutation.mutate(
      { id: receiptId, corrections: Object.keys(corrections).length > 0 ? corrections : undefined },
      {
        onSuccess: () => receiptReviewSuccessToast(),
        onError: (error) => receiptReviewErrorToast(error.response?.data),
      }
    );
  };

  const handleLinkSubmit = (e) => {
    e.preventDefault();
    if (!expenseIdInput.trim()) return;

    linkMutation.mutate(
      { id: receiptId, expenseId: expenseIdInput.trim() },
      {
        onSuccess: () => {
          receiptLinkSuccessToast();
          setExpenseIdInput("");
        },
        onError: (error) => receiptLinkErrorToast(error.response?.data),
      }
    );
  };

  const handleUnlink = () => {
    unlinkMutation.mutate(receiptId, {
      onSuccess: () => receiptUnlinkSuccessToast(),
      onError: (error) => receiptUnlinkErrorToast(error.response?.data),
    });
  };

  const handleDeleteConfirmed = () => {
    deleteMutation.mutate(receiptId, {
      onSuccess: () => {
        receiptDeleteSuccessToast();
        setConfirmDelete(false);
        onBack();
      },
      onError: (error) => {
        receiptDeleteErrorToast(error.response?.data);
        setConfirmDelete(false);
      },
    });
  };

  const handleKeepAsNew = () => {
    duplicateDecisionMutation.mutate(
      { id: receiptId, decision: "confirmed_new" },
      {
        onSuccess: () => receiptDuplicateDecisionSuccessToast("confirmed_new"),
        onError: (error) => receiptDuplicateDecisionErrorToast(error.response?.data),
      }
    );
  };

  const handleLinkToExistingDuplicate = (duplicateOfReceiptId) => {
    duplicateDecisionMutation.mutate(
      { id: receiptId, decision: "linked_existing", duplicateOfReceiptId },
      {
        onSuccess: () => receiptDuplicateDecisionSuccessToast("linked_existing"),
        onError: (error) => receiptDuplicateDecisionErrorToast(error.response?.data),
      }
    );
  };

  return (
    <div className="receipt-detail">
      <div className="receipt-detail-header">
        <button type="button" className="back-btn" onClick={onBack}>
          Back to Inbox
        </button>
        <h2>Receipt</h2>
      </div>

      <QueryState
        isLoading={receiptQuery.isLoading}
        isError={receiptQuery.isError}
        isEmpty={!receiptQuery.isLoading && !receiptQuery.isError && !receipt}
        onRetry={receiptQuery.refetch}
        loadingLabel="Loading this receipt..."
        errorLabel="We couldn't load this receipt. Please try again."
        emptyLabel="This receipt isn't available."
        emptyHint="It may have been deleted, or it doesn't belong to your account."
      >
        {receipt && (
          <>
            <div className="receipt-detail-summary">
              <ReceiptImage imageUrl={receipt.imageUrl} />

              <div className="receipt-detail-meta">
                <div className="receipt-detail-badges">
                  <span className={`receipt-badge receipt-badge--${receipt.reviewStatus}`}>
                    {receipt.reviewStatus === "needs_review" ? "Needs review" : "Reviewed"}
                  </span>
                  {receipt.linkedExpenseId && (
                    <span className="receipt-badge receipt-badge--linked">Linked</span>
                  )}
                </div>

                <span className="receipt-detail-meta-line">
                  Uploaded {formatTimestamp(receipt.uploadedAt) || "—"}
                </span>
                {receipt.reviewedAt && (
                  <span className="receipt-detail-meta-line">
                    Reviewed {formatTimestamp(receipt.reviewedAt)}
                  </span>
                )}
                {typeof fields.overallConfidence === "number" && (
                  <span className="receipt-detail-meta-line">
                    Overall OCR confidence: {Math.round(fields.overallConfidence)}%
                  </span>
                )}
              </div>
            </div>

            {receipt.duplicateStatus === "unreviewed" && duplicateCandidates.length > 0 && (
              <div className="receipt-duplicate-banner" role="status">
                <p className="receipt-duplicate-banner-intro">
                  This receipt looks like it might already be in your inbox.
                </p>

                <ul className="receipt-duplicate-list">
                  {duplicateCandidates.map((candidate) => {
                    const candidateFields = candidate.extractedFields || {};
                    return (
                      <li key={candidate.receiptId} className="receipt-duplicate-item">
                        <ReceiptDuplicateThumbnail
                          imageUrl={candidate.imageUrl}
                          alt="Possible duplicate receipt thumbnail"
                        />

                        <div className="receipt-duplicate-item-text">
                          <span className="receipt-duplicate-reason">
                            {DUPLICATE_REASON_LABELS[candidate.reasonCode] || "Possible duplicate"}
                          </span>
                          <span className="receipt-duplicate-item-name">
                            {candidateFields.expenseName || "Unnamed receipt"}
                          </span>
                          <span className="receipt-duplicate-item-meta">
                            {formatMoney(candidateFields.expenseAmount)}
                            {candidateFields.expenseDate ? ` · ${candidateFields.expenseDate}` : ""}
                          </span>
                          <span className="receipt-duplicate-item-meta">
                            Uploaded {formatTimestamp(candidate.uploadedAt) || "—"}
                          </span>
                        </div>

                        <button
                          type="button"
                          className="receipt-duplicate-link-btn"
                          onClick={() => handleLinkToExistingDuplicate(candidate.receiptId)}
                          disabled={duplicateDecisionMutation.isPending}
                        >
                          This is the same as this one
                        </button>
                      </li>
                    );
                  })}
                </ul>

                <button
                  type="button"
                  className="receipt-duplicate-keep-btn"
                  onClick={handleKeepAsNew}
                  disabled={duplicateDecisionMutation.isPending}
                >
                  Keep as new receipt
                </button>
              </div>
            )}

            {receipt.duplicateStatus === "confirmed_new" && (
              <div className="receipt-duplicate-resolved-note" role="status">
                You confirmed this is a new receipt.
              </div>
            )}

            {receipt.duplicateStatus === "linked_existing" && (
              <div className="receipt-duplicate-resolved-note" role="status">
                Linked to another receipt.
              </div>
            )}

            {fields.needsReview && (
              <div className="receipt-review-banner" role="status">
                We couldn't confidently read every field on this receipt. Please double-check the fields below.
              </div>
            )}

            {Array.isArray(fields.reviewReasons) && fields.reviewReasons.length > 0 && (
              <ul className="receipt-review-reasons">
                {fields.reviewReasons.map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            )}

            <div className="receipt-detail-fields">
              <div className="field">
                <span className="field-label-flex">
                  Name
                  <FieldConfidenceBadge value={fields.fieldConfidence?.expenseName} />
                </span>
                <p className="receipt-detail-field-value">{fields.expenseName || "—"}</p>
              </div>

              <div className="field">
                <span className="field-label-flex">
                  Amount
                  <FieldConfidenceBadge value={fields.fieldConfidence?.expenseAmount} />
                </span>
                <p className="receipt-detail-field-value">{formatMoney(fields.expenseAmount)}</p>
              </div>

              <div className="field">
                <span className="field-label-flex">
                  Date
                  <FieldConfidenceBadge value={fields.fieldConfidence?.expenseDate} />
                </span>
                <p className="receipt-detail-field-value">{fields.expenseDate || "—"}</p>
              </div>
            </div>

            {Array.isArray(fields.amountCandidates) && fields.amountCandidates.length > 0 && (
              <div className="receipt-amount-candidates">
                <span className="receipt-amount-candidates-label">Other amounts found on this receipt:</span>
                <ul>
                  {fields.amountCandidates.map((candidate, index) => (
                    <li key={index}>
                      {formatMoney(candidate.value ?? candidate.amount)}
                      {typeof candidate.confidence === "number" ? ` · ${Math.round(candidate.confidence)}%` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {receipt.reviewStatus === "needs_review" && (
              <form className="receipt-correction-form" onSubmit={handleCorrectionSubmit}>
                <h3>Correct this receipt</h3>

                <div className="field">
                  <label htmlFor="receipt-correction-name">Name of the Expense</label>
                  <input
                    id="receipt-correction-name"
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="receipt-correction-amount">Amount Spent</label>
                  <input
                    id="receipt-correction-amount"
                    type="number"
                    min={0}
                    step="any"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="receipt-correction-date">Date Spent</label>
                  <input
                    id="receipt-correction-date"
                    type="text"
                    value={dateInput}
                    onChange={(e) => setDateInput(e.target.value)}
                  />
                </div>

                <button type="submit" className="submit-btn" disabled={reviewMutation.isPending}>
                  {reviewMutation.isPending ? "Saving…" : "Save Corrections & Mark Reviewed"}
                </button>
              </form>
            )}

            <div className="receipt-link-section">
              {receipt.linkedExpenseId ? (
                <div className="receipt-link-status">
                  <span>Linked to expense {receipt.linkedExpenseId}</span>
                  <button
                    type="button"
                    className="receipt-unlink-btn"
                    onClick={handleUnlink}
                    disabled={unlinkMutation.isPending}
                  >
                    {unlinkMutation.isPending ? "Unlinking…" : "Unlink"}
                  </button>
                </div>
              ) : (
                <form className="receipt-link-form" onSubmit={handleLinkSubmit}>
                  <div className="field">
                    <label htmlFor="receipt-link-expense-id">Link to expense (expense ID)</label>
                    <input
                      id="receipt-link-expense-id"
                      type="text"
                      value={expenseIdInput}
                      onChange={(e) => setExpenseIdInput(e.target.value)}
                    />
                  </div>
                  <button type="submit" className="receipt-link-btn" disabled={linkMutation.isPending}>
                    {linkMutation.isPending ? "Linking…" : "Link"}
                  </button>
                </form>
              )}
            </div>

            <button type="button" className="receipt-delete-btn" onClick={() => setConfirmDelete(true)}>
              Delete Receipt
            </button>
          </>
        )}
      </QueryState>

      {confirmDelete && (
        <DeleteAlert
          confirmDeleteId={receiptId}
          confirmDeleteHandler={handleDeleteConfirmed}
          cancelDeleteHandler={() => setConfirmDelete(false)}
          message="Are you sure you want to delete this receipt? This can't be undone."
        />
      )}
    </div>
  );
};

export default ReceiptDetail;
