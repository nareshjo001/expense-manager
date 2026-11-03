import React, { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useExpenseSearchQuery } from "../../hooks/queries/useExpenseSearchQuery";
import { format as formatDate, parseISO } from "date-fns";
import {
  FiArrowLeft,
  FiSearch,
  FiCalendar,
  FiShield,
  FiInfo,
  FiAlertTriangle,
  FiEdit3,
  FiCheckCircle,
  FiLink,
  FiTrash2,
  FiMaximize2,
  FiX,
  FiShoppingBag,
  FiPlus,
} from "react-icons/fi";
import { FaRupeeSign } from "react-icons/fa";
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

const formatFieldConfidence = (value) => (typeof value === "number" ? Math.round(value) : null);

function formatTimestamp(value) {
  if (!value) return null;
  try {
    return formatDate(parseISO(value), "d MMM yyyy, HH:mm");
  } catch {
    return null;
  }
}

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

function ReceiptImage({ imageUrl, onExpand }) {
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

  return (
    <div className="receipt-detail-image-wrapper">
      <img className="receipt-detail-image" src={objectUrl} alt="Receipt" />
      {onExpand && (
        <button
          type="button"
          className="receipt-image-expand-btn"
          onClick={onExpand}
          aria-label="Enlarge receipt image"
          title="Enlarge receipt image"
        >
          <FiMaximize2 />
        </button>
      )}
    </div>
  );
}

const DUPLICATE_REASON_LABELS = {
  EXACT_FILE_MATCH: "Same file already uploaded",
  PROBABLE_MERCHANT_DATE_AMOUNT: "Looks like the same purchase",
};

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

const ReceiptDetail = ({ receiptId, onBack }) => {
  const receiptQuery = useReceiptDetailQuery(receiptId);
  const duplicatesQuery = useReceiptDuplicatesQuery(receiptId);
  const linkMutation = useLinkReceiptMutation();
  const unlinkMutation = useUnlinkReceiptMutation();
  const reviewMutation = useMarkReceiptReviewedMutation();
  const deleteMutation = useDeleteReceiptMutation();
  const duplicateDecisionMutation = useRecordDuplicateDecisionMutation();
  const navigate = useNavigate();

  const receipt = receiptQuery.data?.success ? receiptQuery.data.data : null;
  const fields = receipt?.extractedFields || {};
  const duplicateCandidates = duplicatesQuery.data?.success ? duplicatesQuery.data.data : [];

  const [nameInput, setNameInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [dateInput, setDateInput] = useState("");
  const [expenseIdInput, setExpenseIdInput] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const pickerRef = useRef(null);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  const targetDate = fields.expenseDate ? new Date(fields.expenseDate) : new Date();
  const validTarget = !Number.isNaN(targetDate.getTime()) ? targetDate : new Date();
  const startDate = new Date(validTarget.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const endDate = new Date(validTarget.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const expenseSearchQuery = useExpenseSearchQuery(
    startDate,
    endDate,
    { limit: 50 },
    Boolean(receiptId && !receipt?.linkedExpenseId)
  );
  const candidateExpenses = useMemo(() => expenseSearchQuery.data?.data || [], [expenseSearchQuery.data?.data]);

  const bestMatch = useMemo(() => {
    if (!candidateExpenses || candidateExpenses.length === 0) return null;
    const receiptAmount = typeof fields.expenseAmount === "number" ? fields.expenseAmount : null;
    const receiptName = (fields.expenseName || "").trim().toLowerCase();
    const receiptDateStr = fields.expenseDate ? fields.expenseDate.split("T")[0] : "";

    if (receiptAmount === null && !receiptName) return null;

    let topCandidate = null;
    let topScore = 0;

    for (const exp of candidateExpenses) {
      let score = 0;
      const expAmount = typeof exp.expenseAmount === "number" ? exp.expenseAmount : null;
      const expName = (exp.expenseName || "").trim().toLowerCase();
      const expDateStr = exp.expenseDate ? exp.expenseDate.split("T")[0] : "";

      if (receiptAmount !== null && expAmount !== null) {
        if (Math.abs(expAmount - receiptAmount) < 0.01) {
          score += 50;
        } else if (Math.abs(expAmount - receiptAmount) / receiptAmount < 0.05) {
          score += 20;
        }
      }

      if (receiptName && expName) {
        if (receiptName === expName) {
          score += 40;
        } else if (receiptName.includes(expName) || expName.includes(receiptName)) {
          score += 25;
        }
      }

      if (receiptDateStr && expDateStr) {
        if (receiptDateStr === expDateStr) {
          score += 20;
        } else {
          const daysDiff = Math.abs((new Date(receiptDateStr) - new Date(expDateStr)) / (1000 * 60 * 60 * 24));
          if (daysDiff <= 3) score += 10;
        }
      }

      if (score > topScore && score >= 40) {
        topScore = score;
        topCandidate = exp;
      }
    }

    return topCandidate;
  }, [candidateExpenses, fields.expenseAmount, fields.expenseName, fields.expenseDate]);

  const filteredExpenses = useMemo(() => {
    if (!candidateExpenses || candidateExpenses.length === 0) return [];
    const query = (expenseIdInput || "").trim().toLowerCase();
    if (!query) return candidateExpenses.slice(0, 8);

    return candidateExpenses.filter((exp) => {
      const name = (exp.expenseName || "").toLowerCase();
      const cat = (exp.expenseCategory || "").toLowerCase();
      const amt = String(exp.expenseAmount || "");
      const id = String(exp._id || "");
      return name.includes(query) || cat.includes(query) || amt.includes(query) || id.includes(query);
    }).slice(0, 8);
  }, [candidateExpenses, expenseIdInput]);

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

  const handleLinkToExpenseId = (targetExpenseId) => {
    if (!targetExpenseId) return;
    linkMutation.mutate(
      { id: receiptId, expenseId: targetExpenseId },
      {
        onSuccess: () => {
          receiptLinkSuccessToast();
          setExpenseIdInput("");
          setIsDropdownOpen(false);
        },
        onError: (error) => receiptLinkErrorToast(error.response?.data),
      }
    );
  };

  const handleCreateExpenseFromReceipt = () => {
    navigate("/add", {
      state: {
        receiptData: {
          expenseName: fields.expenseName || "",
          expenseAmount: typeof fields.expenseAmount === "number" ? fields.expenseAmount : "",
          expenseDate: fields.expenseDate ? fields.expenseDate.split("T")[0] : "",
          expenseCategory: fields.expenseCategory || "",
          receiptId: receipt?.id || receiptId,
        },
      },
    });
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
      {/* Top Header Navigation */}
      <div className="receipt-detail-top-nav">
        <button
          type="button"
          className="receipt-back-btn back-btn"
          onClick={onBack}
          aria-label="Back to Inbox"
        >
          <FiArrowLeft className="receipt-back-btn-icon" aria-hidden="true" />
          <span className="receipt-back-btn-text">Back to Inbox</span>
        </button>
        <div className="receipt-detail-title-wrapper">
          <h2 className="receipt-detail-title">Receipt</h2>
        </div>
        <span className="receipt-top-nav-spacer" aria-hidden="true" />
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
          <div className="receipt-detail-content">
            {/* Card 1: Top Hero Inspection Card */}
            <div className="receipt-detail-card receipt-detail-hero-card">
              <div className="receipt-hero-split-layout">
                {/* Left Column: Image with Expand Option */}
                <div className="receipt-hero-image-column">
                  <ReceiptImage
                    imageUrl={receipt.imageUrl}
                    onExpand={() => setIsImageModalOpen(true)}
                  />
                </div>

                {/* Right Column: Metadata, Confidence & Issues */}
                <div className="receipt-hero-info-column">
                  <div className="receipt-status-pill-row">
                    <span className={`receipt-badge receipt-badge-pill receipt-badge--${receipt.reviewStatus} receipt-badge-pill--${receipt.reviewStatus}`}>
                      <FiSearch className="receipt-badge-pill-icon" aria-hidden="true" />
                      {receipt.reviewStatus === "needs_review" ? "NEEDS REVIEW" : "REVIEWED"}
                    </span>
                    {receipt.linkedExpenseId && (
                      <span className="receipt-badge receipt-badge-pill receipt-badge--linked receipt-badge-pill--linked">
                        <FiLink className="receipt-badge-pill-icon" aria-hidden="true" />
                        LINKED
                      </span>
                    )}
                  </div>

                  <div className="receipt-meta-info-list">
                    <div className="receipt-meta-info-item">
                      <FiCalendar className="receipt-meta-info-icon" aria-hidden="true" />
                      <span className="receipt-detail-meta-line">
                        Uploaded: {formatTimestamp(receipt.uploadedAt) || "—"}
                      </span>
                    </div>

                    {receipt.reviewedAt && (
                      <div className="receipt-meta-info-item">
                        <FiCheckCircle className="receipt-meta-info-icon" aria-hidden="true" />
                        <span className="receipt-detail-meta-line">
                          Reviewed: {formatTimestamp(receipt.reviewedAt)}
                        </span>
                      </div>
                    )}

                    {typeof fields.overallConfidence === "number" && (
                      <div className="receipt-meta-info-item">
                        <FiShield className="receipt-meta-info-icon" aria-hidden="true" />
                        <span className="receipt-detail-meta-line">
                          Overall OCR confidence:{" "}
                          <strong className="receipt-confidence-value">
                            {Math.round(fields.overallConfidence)}%
                          </strong>
                        </span>
                        <FiInfo className="receipt-meta-info-hint-icon" title="Overall scan confidence score" aria-hidden="true" />
                      </div>
                    )}
                  </div>

                  {/* Issues Detected Box */}
                  {Array.isArray(fields.reviewReasons) && fields.reviewReasons.length > 0 && (
                    <div className="receipt-issues-callout">
                      <div className="receipt-issues-callout-header">
                        <FiAlertTriangle className="receipt-issues-icon" aria-hidden="true" />
                        <h4 className="receipt-issues-heading">Issues detected</h4>
                      </div>
                      <ul className="receipt-review-reasons">
                        {fields.reviewReasons.map((reason, index) => (
                          <li key={index}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {/* Duplicate Candidates Banner */}
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
            </div>

            {/* Warning Banner between Card 1 and Card 2 */}
            {fields.needsReview && (
              <div className="receipt-review-banner" role="status">
                <FiInfo className="receipt-review-banner-icon" aria-hidden="true" />
                <span>
                  We couldn't confidently read every field on this receipt. Please double-check the fields below.
                </span>
              </div>
            )}

            {/* Card 2: Extracted Details Card */}
            <div className="receipt-detail-card receipt-extracted-details-card">
              <div className="receipt-card-header">
                <div className="receipt-card-title-group">
                  <FiEdit3 className="receipt-card-title-icon" aria-hidden="true" />
                  <h3 className="receipt-card-title">Extracted Details</h3>
                </div>
                {typeof fields.overallConfidence === "number" && (
                  <span className="receipt-confidence-score-badge">
                    <FiCheckCircle className="receipt-score-badge-icon" aria-hidden="true" />
                    <span>
                      Receipt confidence: <strong>{Math.round(fields.overallConfidence)}%</strong>
                    </span>
                  </span>
                )}
              </div>

              {/* 3-Column Summary Strip */}
              <div className="receipt-extracted-summary-strip receipt-detail-fields">
                <div className="receipt-extracted-col field">
                  <div className="receipt-extracted-icon-box" aria-hidden="true">
                    <FiShoppingBag />
                  </div>
                  <div className="receipt-extracted-col-content">
                    <span className="field-label-flex">
                      Name
                      <FieldConfidenceBadge value={fields.fieldConfidence?.expenseName} />
                    </span>
                    <p className="receipt-detail-field-value">{fields.expenseName || "—"}</p>
                  </div>
                </div>

                <span className="receipt-extracted-divider" aria-hidden="true" />

                <div className="receipt-extracted-col field">
                  <div className="receipt-extracted-icon-box" aria-hidden="true">
                    <FaRupeeSign />
                  </div>
                  <div className="receipt-extracted-col-content">
                    <span className="field-label-flex">
                      Amount
                      <FieldConfidenceBadge value={fields.fieldConfidence?.expenseAmount} />
                    </span>
                    <p className="receipt-detail-field-value">{formatMoney(fields.expenseAmount)}</p>
                  </div>
                </div>

                <span className="receipt-extracted-divider" aria-hidden="true" />

                <div className="receipt-extracted-col field">
                  <div className="receipt-extracted-icon-box" aria-hidden="true">
                    <FiCalendar />
                  </div>
                  <div className="receipt-extracted-col-content">
                    <span className="field-label-flex">
                      Date
                      <FieldConfidenceBadge value={fields.fieldConfidence?.expenseDate} />
                    </span>
                    <p className="receipt-detail-field-value">{fields.expenseDate || "—"}</p>
                  </div>
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
            </div>

            {/* Card 3: Correction Form & Actions Card */}
            <div className="receipt-detail-card receipt-actions-card">
              {receipt.reviewStatus === "needs_review" && (
                <form className="receipt-correction-form" onSubmit={handleCorrectionSubmit}>
                  <div className="receipt-card-header receipt-correction-form-header">
                    <div className="receipt-card-title-group">
                      <FiEdit3 className="receipt-card-title-icon" aria-hidden="true" />
                      <h3 className="receipt-card-title">Correct this receipt</h3>
                    </div>
                  </div>

                  <div className="receipt-input-group field">
                    <label htmlFor="receipt-correction-name" className="receipt-input-label">
                      Name of the Expense
                    </label>
                    <div className="receipt-input-field-wrapper">
                      <span className="receipt-input-icon-block" aria-hidden="true">
                        <FiShoppingBag />
                      </span>
                      <input
                        id="receipt-correction-name"
                        className="receipt-form-input"
                        type="text"
                        placeholder="Enter expense name"
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="receipt-input-group field">
                    <label htmlFor="receipt-correction-amount" className="receipt-input-label">
                      Amount Spent
                    </label>
                    <div className="receipt-input-field-wrapper">
                      <span className="receipt-input-icon-block" aria-hidden="true">
                        <FaRupeeSign />
                      </span>
                      <input
                        id="receipt-correction-amount"
                        className="receipt-form-input"
                        type="number"
                        min={0}
                        step="any"
                        placeholder="Enter amount"
                        value={amountInput}
                        onChange={(e) => setAmountInput(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="receipt-input-group field">
                    <label htmlFor="receipt-correction-date" className="receipt-input-label">
                      Date Spent
                    </label>
                    <div className="receipt-input-field-wrapper">
                      <span className="receipt-input-icon-block" aria-hidden="true">
                        <FiCalendar />
                      </span>
                      <input
                        id="receipt-correction-date"
                        className="receipt-form-input"
                        type="text"
                        placeholder="Select date"
                        value={dateInput}
                        onChange={(e) => setDateInput(e.target.value)}
                      />
                      <span className="receipt-input-trailing-icon" aria-hidden="true">
                        <FiCalendar />
                      </span>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="submit-btn receipt-submit-correction-btn"
                    disabled={reviewMutation.isPending}
                  >
                    <FiCheckCircle className="receipt-submit-btn-icon" aria-hidden="true" />
                    <span>{reviewMutation.isPending ? "Saving…" : "Save Corrections & Mark Reviewed"}</span>
                  </button>
                </form>
              )}

              {/* Link to Expense Row */}
              <div className="receipt-link-section">
                {receipt.linkedExpenseId ? (
                  <div className="receipt-link-status">
                    <div className="receipt-link-status-text">
                      <FiLink className="receipt-link-icon" aria-hidden="true" />
                      <span>
                        Linked to expense <strong>{receipt.linkedExpenseId}</strong>
                      </span>
                    </div>
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
                  <div className="receipt-link-container">
                    {/* Suggested Match Banner */}
                    {bestMatch && (
                      <div className="receipt-suggested-match-box" role="region" aria-label="Suggested matching expense">
                        <div className="receipt-suggested-match-title">
                          <FiCheckCircle className="suggested-match-icon" aria-hidden="true" />
                          <span>Matching Expense Found</span>
                        </div>
                        <div className="receipt-suggested-match-details">
                          <div className="suggested-match-name">{bestMatch.expenseName}</div>
                          <div className="suggested-match-meta">
                            {formatMoney(bestMatch.expenseAmount)} · {bestMatch.expenseDate?.split("T")[0]} · {bestMatch.expenseCategory}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="receipt-suggested-match-btn"
                          onClick={() => handleLinkToExpenseId(bestMatch._id)}
                          disabled={linkMutation.isPending}
                        >
                          <FiLink aria-hidden="true" />
                          <span>Link to this Expense</span>
                        </button>
                      </div>
                    )}

                    <form className="receipt-link-form" onSubmit={handleLinkSubmit}>
                      <label htmlFor="receipt-link-expense-id" className="receipt-link-label">
                        <FiLink className="receipt-link-icon" aria-hidden="true" />
                        Link to expense (search or ID)
                      </label>
                      <div className="receipt-link-input-row">
                        <div className="receipt-picker-container" ref={pickerRef}>
                          <input
                            id="receipt-link-expense-id"
                            type="text"
                            className="receipt-link-input"
                            placeholder="Search expense name or amount, or enter ID"
                            value={expenseIdInput}
                            onChange={(e) => {
                              setExpenseIdInput(e.target.value);
                              setIsDropdownOpen(true);
                            }}
                            onFocus={() => setIsDropdownOpen(true)}
                            autoComplete="off"
                          />

                          {/* Search Dropdown / Picker */}
                          {isDropdownOpen && (
                            <div className="receipt-expense-picker-dropdown" role="listbox">
                              <div className="receipt-picker-dropdown-header">
                                <span>
                                  {expenseIdInput.trim()
                                    ? `Search results for "${expenseIdInput.trim()}":`
                                    : "Recent expenses (type to filter):"}
                                </span>
                                <button
                                  type="button"
                                  className="receipt-picker-dropdown-close"
                                  onClick={() => setIsDropdownOpen(false)}
                                  aria-label="Close suggestions"
                                >
                                  ✕
                                </button>
                              </div>
                              {filteredExpenses.length === 0 ? (
                                <div className="receipt-picker-empty-message">
                                  No expenses found matching &ldquo;{expenseIdInput.trim()}&rdquo;
                                </div>
                              ) : (
                                <div className="receipt-picker-dropdown-items">
                                  {filteredExpenses.map((exp) => (
                                    <button
                                      key={exp._id}
                                      type="button"
                                      className="receipt-picker-dropdown-item"
                                      onClick={() => {
                                        setExpenseIdInput(exp._id);
                                        setIsDropdownOpen(false);
                                        handleLinkToExpenseId(exp._id);
                                      }}
                                    >
                                      <div className="picker-item-left">
                                        <span className="picker-item-name">{exp.expenseName}</span>
                                        <span className="picker-item-meta">
                                          {exp.expenseCategory} · {exp.expenseDate?.split("T")[0]}
                                        </span>
                                      </div>
                                      <span className="picker-item-amount">{formatMoney(exp.expenseAmount)}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <button
                          type="submit"
                          className="receipt-link-btn"
                          disabled={linkMutation.isPending || !expenseIdInput.trim()}
                        >
                          <FiLink className="receipt-btn-icon" aria-hidden="true" />
                          <span>{linkMutation.isPending ? "Linking…" : "Link"}</span>
                        </button>
                      </div>
                    </form>

                    {/* Create Expense from this Receipt button */}
                    <div className="receipt-create-expense-section">
                      <span className="receipt-create-expense-hint">Haven't recorded this expense yet?</span>
                      <button
                        type="button"
                        className="receipt-create-expense-btn"
                        onClick={handleCreateExpenseFromReceipt}
                      >
                        <FiPlus className="receipt-btn-icon" aria-hidden="true" />
                        <span>Create Expense from this Receipt</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Actions Row: Delete Button */}
              <div className="receipt-bottom-actions-row">
                <button
                  type="button"
                  className="receipt-delete-btn"
                  onClick={() => setConfirmDelete(true)}
                >
                  <FiTrash2 className="receipt-delete-icon" aria-hidden="true" />
                  <span>Delete Receipt</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </QueryState>

      {/* Enlarged Image Lightbox Modal */}
      {isImageModalOpen && receipt && (
        <div
          className="receipt-image-modal-overlay"
          onClick={() => setIsImageModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged Receipt Image"
        >
          <div className="receipt-image-modal-content" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="receipt-image-modal-close"
              onClick={() => setIsImageModalOpen(false)}
              aria-label="Close enlarged receipt image"
            >
              <FiX />
            </button>
            <ReceiptImage imageUrl={receipt.imageUrl} />
          </div>
        </div>
      )}

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
