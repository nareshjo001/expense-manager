import React, { useState } from "react";
import { useSiaAskMutation } from "../../hooks/mutations/useSiaAskMutation";
import "./SiaPanel.css";

const GENERIC_ERROR_MESSAGE = "SIA is temporarily unavailable. Please try again.";

// Extracts only a plain, safe string message from a rejected Axios error's
// response body -- never the raw error object, Axios config, stack trace,
// or response body as a whole. Anything that isn't a non-blank string
// falls back to a generic, safe message. Matches the backend's own
// {success:false, message: string} error contract (see
// backend/Controllers/SiaControllers/ask.js's 400/422/503 responses).
function getErrorMessage(error) {
  const message = error && error.response && error.response.data && error.response.data.message;
  return typeof message === "string" && message.trim() !== "" ? message : GENERIC_ERROR_MESSAGE;
}

// M4-4: the actual question/answer surface. Always mounted fresh by
// SiaEntryPoint (never retained across opens/closes), so there is no
// message history here -- only the latest question and its outcome.
// Uses useSiaAskMutation (M4-2) directly; never imports askSia (M4-1)
// itself, and never adds onSuccess/onError callbacks to the mutation.
const SiaPanel = ({ onClose }) => {
  const mutation = useSiaAskMutation();
  const [question, setQuestion] = useState("");
  const [lastSubmittedQuestion, setLastSubmittedQuestion] = useState(null);

  const canSubmit = question.trim() !== "" && !mutation.isPending;

  // Trimming is used only to decide whether a submission is allowed -- the
  // original, untrimmed question string is always what's sent to the
  // mutation, unchanged.
  const submitQuestion = (value) => {
    setLastSubmittedQuestion(value);
    mutation.mutate(value);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (question.trim() === "" || mutation.isPending) {
      return;
    }
    submitQuestion(question);
  };

  const handleRetry = () => {
    if (lastSubmittedQuestion === null || mutation.isPending) {
      return;
    }
    submitQuestion(lastSubmittedQuestion);
  };

  const handleClose = () => {
    if (typeof onClose === "function") {
      onClose();
    }
  };

  return (
    <div
      className="sia-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="sia-panel-heading"
    >
      <div className="sia-panel-header">
        <h2 id="sia-panel-heading" className="sia-panel-heading">
          Ask SIA
        </h2>
        <button
          type="button"
          className="sia-panel-close"
          aria-label="Close SIA"
          onClick={handleClose}
        >
          &times;
        </button>
      </div>

      <form className="sia-panel-form" onSubmit={handleSubmit}>
        <label htmlFor="sia-question-input" className="sia-panel-label">
          Your question
        </label>
        <textarea
          id="sia-question-input"
          className="sia-panel-input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          disabled={mutation.isPending}
          rows={3}
        />
        <button type="submit" className="sia-panel-submit" disabled={!canSubmit}>
          Ask
        </button>
      </form>

      {mutation.isPending && (
        <p className="sia-panel-status" role="status">
          SIA is thinking&hellip;
        </p>
      )}

      {!mutation.isPending && mutation.isSuccess && mutation.data && (
        <p className="sia-panel-answer">{mutation.data.answer}</p>
      )}

      {!mutation.isPending && mutation.isError && (
        <div className="sia-panel-error-block">
          <p className="sia-panel-error" role="alert">
            {getErrorMessage(mutation.error)}
          </p>
          {lastSubmittedQuestion !== null && (
            <button type="button" className="sia-panel-retry" onClick={handleRetry}>
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default SiaPanel;
