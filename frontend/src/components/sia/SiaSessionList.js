import React, { useState } from "react";
import { FiArrowLeft, FiTrash2 } from "react-icons/fi";
import { useSiaSessionsQuery } from "../../hooks/queries/useSiaSessionsQuery";
import { useSiaDeleteSessionMutation } from "../../hooks/mutations/useSiaDeleteSessionMutation";

// Renders only fields the backend actually returns for a session
// (sessionId, title, messageCount, lastMessageAt, createdAt, updatedAt --
// see backend/Controllers/SiaControllers/sessions.js). No client-side
// auto-naming is invented: when the server has no title, a neutral label
// plus the real timestamp is used instead of guessing one from message
// content.
const FALLBACK_TITLE = "SIA conversation";

function formatTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const SiaSessionList = ({ isOpen, onSelect, onBack, activeSessionId, onActiveSessionDeleted }) => {
  // `isOpen` gates the query itself -- history is never fetched at app
  // startup, only when this view is actually shown.
  const { data, isLoading, isError, refetch, isFetching } = useSiaSessionsQuery(isOpen);
  const deleteMutation = useSiaDeleteSessionMutation();
  const [confirmingId, setConfirmingId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);

  const sessions = Array.isArray(data?.sessions) ? data.sessions : [];

  const handleConfirmDelete = (sessionId) => {
    setDeleteError(null);
    deleteMutation.mutate(sessionId, {
      onSuccess: () => {
        setConfirmingId(null);
        if (sessionId === activeSessionId && typeof onActiveSessionDeleted === "function") {
          onActiveSessionDeleted(sessionId);
        }
      },
      onError: () => {
        // The row stays exactly where it was and its controls come back --
        // deletion is never optimistic, so there is nothing to roll back.
        setConfirmingId(null);
        setDeleteError("That conversation could not be deleted. Please try again.");
      },
    });
  };

  return (
    <div className="sia-history">
      <div className="sia-history-bar">
        <button type="button" className="sia-secondary-btn" onClick={onBack}>
          <FiArrowLeft aria-hidden="true" />
          Back to conversation
        </button>
      </div>

      <div className="sia-history-body" role="region" aria-label="Conversation history">
        <p className="sia-visually-hidden" role="status">
          {isLoading || isFetching ? "Loading conversation history" : ""}
        </p>

        {isLoading && <p className="sia-muted">Loading your conversations&hellip;</p>}

        {!isLoading && isError && (
          <div className="sia-error-block">
            <p className="sia-error" role="alert">
              Conversation history is temporarily unavailable.
            </p>
            <button type="button" className="sia-secondary-btn" onClick={() => refetch()}>
              Try again
            </button>
          </div>
        )}

        {!isLoading && !isError && sessions.length === 0 && (
          <p className="sia-muted">No past conversations yet.</p>
        )}

        {deleteError && (
          <p className="sia-error" role="alert">
            {deleteError}
          </p>
        )}

        {!isLoading && !isError && sessions.length > 0 && (
          <ul className="sia-history-list">
            {sessions.map((session) => {
              const label = session.title || FALLBACK_TITLE;
              const timestamp = formatTimestamp(session.lastMessageAt || session.updatedAt || session.createdAt);
              const isConfirming = confirmingId === session.sessionId;

              return (
                <li key={session.sessionId} className="sia-history-row">
                  <button
                    type="button"
                    className="sia-history-open"
                    onClick={() => onSelect(session.sessionId)}
                  >
                    <span className="sia-history-title">{label}</span>
                    <span className="sia-history-meta">
                      {timestamp}
                      {typeof session.messageCount === "number" ? ` · ${session.messageCount} messages` : ""}
                    </span>
                  </button>

                  {isConfirming ? (
                    // An inline, testable confirmation rather than an
                    // untestable window.confirm.
                    <span className="sia-confirm">
                      <span className="sia-confirm-text">Delete?</span>
                      <button
                        type="button"
                        className="sia-danger-btn"
                        onClick={() => handleConfirmDelete(session.sessionId)}
                        disabled={deleteMutation.isPending}
                      >
                        Confirm delete
                      </button>
                      <button
                        type="button"
                        className="sia-secondary-btn"
                        onClick={() => setConfirmingId(null)}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="sia-icon-btn sia-history-delete"
                      aria-label={`Delete ${label}`}
                      title="Delete conversation"
                      onClick={() => setConfirmingId(session.sessionId)}
                    >
                      <FiTrash2 aria-hidden="true" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default SiaSessionList;
