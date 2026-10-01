import React, { useState } from "react";
import "./NaturalLanguageQuickAdd.css";
import { FaArrowLeft } from "react-icons/fa";
import { FaWandMagicSparkles } from "react-icons/fa6";
import { HiOutlineDocumentPlus, HiOutlineExclamationCircle, HiSparkles } from "react-icons/hi2";
import { expenseAddErrorToast } from "../alertsEffects/toastMessages";
import { useParseExpenseMutation } from "../../hooks/mutations/useParseExpenseMutation";

const MAX_TEXT_LENGTH = 200;

// Natural-language expense entry: parses a free-text sentence (e.g. "spent 250 on lunch yesterday at Cafe X")
// into a prefillable expense payload via SIA (AI-002). Mirrors BillUpload.js's open/close and setBillData
// hand-off pattern exactly, so it reuses AddExpense.js's existing pre-fill/review/confidence-badge UI unchanged.
const NaturalLanguageQuickAdd = ({ setIsQuickAdd, setBillData }) => {
  const [text, setText] = useState("");
  const [parseMessage, setParseMessage] = useState("");

  const parseExpenseMutation = useParseExpenseMutation();

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setParseMessage("");
    parseExpenseMutation.mutate(trimmed, {
      onSuccess: (response) => {
        if (response.success) {
          setBillData(response.parsed);
          setIsQuickAdd(false);
          return;
        }

        // 200 "couldn't parse" (success:false) -- a normal resolved response, not an error.
        // Shown inline so the user can edit their text and retry, without closing this component.
        setParseMessage(response.message || "Couldn't understand that expense. Try rephrasing it.");
      },
      onError: (error) => {
        // 401/429/409 are already surfaced by the shared axios interceptor — avoid toasting a second time.
        const status = error.response?.status;
        if (status === 401 || status === 429 || status === 409) {
          return;
        }

        expenseAddErrorToast({ message: error.response?.data?.message || "Failed to parse expense. Please try again." });
      },
    });
  };

  return (
    <div className="nl-quick-add-wrapper">
      <div className="nl-quick-add-container">

        <div className="nl-quick-add-header">
          <button
            className="back-btn"
            onClick={() => setIsQuickAdd(false)}
          >
            <FaArrowLeft size={13} aria-hidden="true" /> Back
          </button>

          <div className="nl-quick-add-heading">
            <span className="nl-quick-add-heading-icon" aria-hidden="true">
              <HiOutlineDocumentPlus />
            </span>
            <div>
              <h2>Quick Add</h2>
              <p className="nl-quick-add-subtitle">Add your expense in seconds</p>
            </div>
          </div>
        </div>

        <div className="nl-quick-add-input-section">
          <label htmlFor="nl-quick-add-text">Describe the expense in one sentence</label>

          <div className="nl-quick-add-input-wrap">
            <HiSparkles className="nl-quick-add-input-icon" aria-hidden="true" />
            <input
              id="nl-quick-add-text"
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={MAX_TEXT_LENGTH}
              placeholder='e.g. "spent 250 on lunch yesterday at Cafe X"'
              aria-describedby={parseMessage ? "nl-quick-add-message" : undefined}
            />
          </div>
          {parseMessage && (
            <p id="nl-quick-add-message" className="nl-quick-add-message" role="status" aria-live="polite">
              <HiOutlineExclamationCircle aria-hidden="true" />
              {parseMessage}
            </p>
          )}
        </div>

        <button
          type="button"
          className="nl-quick-add-btn"
          onClick={handleSubmit}
          disabled={parseExpenseMutation.isPending || !text.trim()}
        >
          <FaWandMagicSparkles aria-hidden="true" />
          {parseExpenseMutation.isPending ? "Parsing..." : "Parse Expense"}
        </button>
      </div>
    </div>
  );
};

export default NaturalLanguageQuickAdd;
