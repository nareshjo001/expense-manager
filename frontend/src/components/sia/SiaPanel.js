import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import SiaSessionList from "./SiaSessionList";
import SiaGroundingDisclosure from "./SiaGroundingDisclosure";
import { SIA_SUGGESTIONS } from "./siaSuggestions";
import { useSiaSessionMessagesQuery } from "../../hooks/queries/useSiaSessionMessagesQuery";
import { queryKeys } from "../../query/queryKeys";
import {
  PANEL_MODE,
  SIA_ERROR_CODE,
  MAX_QUESTION_LENGTH,
  normalizeServerMessages,
} from "./useSiaConversation";
import "./SiaPanel.css";

// Presentation only. Every piece of conversation state lives in
// SiaEntryPoint's useSiaConversation() hook, so unmounting this component
// on close never loses the transcript, the active session, or an in-flight
// request.
//
// Answers are rendered as plain text (never dangerouslySetInnerHTML);
// newlines are handled by CSS `white-space: pre-wrap`, so HTML-looking
// content from a provider can only ever appear as literal characters.
// Batch 3E availability props (all optional, so any existing caller/test
// that renders SiaPanel without them keeps working):
//   isAvailable            -- backend confirmed SIA can answer a new question
//   isCheckingAvailability -- the status request is still in flight
//   onRetryAvailability    -- refetches status after a failure/unavailability
//
// Both flags default to a FAIL-CLOSED posture at the point of use below:
// submission is enabled only on an explicit `isAvailable === true`.
const SiaPanel = ({ onClose, conversation, isAvailable, isCheckingAvailability, onRetryAvailability }) => {
  const {
    messages,
    input,
    pending,
    failed,
    mode,
    activeSessionId,
    selectedHistorySessionId,
    canSubmit,
    isBusy,
    setInput,
    submitQuestion,
    retry,
    dismissFailed,
    newChat,
    setMode,
    selectHistorySession,
    hydrate,
    clearActiveSession,
  } = conversation;

  const composerRef = useRef(null);
  const transcriptEndRef = useRef(null);
  const closeButtonRef = useRef(null);
  const queryClient = useQueryClient();
  const [historyLoadError, setHistoryLoadError] = useState(null);

  // Only fetches once a session is actually selected.
  const messagesQuery = useSiaSessionMessagesQuery(selectedHistorySessionId);

  // A failed load (typically a 404 for a session deleted elsewhere) returns
  // the user to the history list with an understandable message and
  // refreshes that list -- the existing local transcript is never touched,
  // because hydration only ever happens on success.
  useEffect(() => {
    if (!selectedHistorySessionId || !messagesQuery.isError) return;
    setHistoryLoadError("That conversation could not be opened. It may have been deleted.");
    selectHistorySession(null);
    queryClient.invalidateQueries({ queryKey: queryKeys.sia.sessions.list() });
  }, [selectedHistorySessionId, messagesQuery.isError, selectHistorySession, queryClient]);

  // Hydrate exactly once per successful load, and only for the session
  // still selected -- the reducer itself re-checks, so a slow response for
  // an abandoned selection can never overwrite a newer conversation.
  useEffect(() => {
    if (!selectedHistorySessionId || !messagesQuery.isSuccess) return;
    const loadedSessionId = messagesQuery.data?.sessionId || selectedHistorySessionId;
    if (String(loadedSessionId) !== String(selectedHistorySessionId)) return;
    hydrate(selectedHistorySessionId, normalizeServerMessages(messagesQuery.data?.messages));
  }, [selectedHistorySessionId, messagesQuery.isSuccess, messagesQuery.data, hydrate]);

  // Move focus into the composer when the panel opens.
  useEffect(() => {
    if (mode === PANEL_MODE.CONVERSATION && composerRef.current) {
      composerRef.current.focus();
    }
  }, [mode]);

  // Follow the newest message on submit/answer. Guarded because jsdom (and
  // some older browsers) do not implement scrollIntoView.
  useEffect(() => {
    if (transcriptEndRef.current?.scrollIntoView) {
      transcriptEndRef.current.scrollIntoView({ block: "end" });
    }
  }, [messages.length, pending]);

  // Batch 3E: the single fail-closed gate every submission route consults.
  // Explicit `=== true` rather than truthiness, and an undefined prop (an
  // older caller, or a test rendering the panel bare) therefore reads as
  // NOT submittable only when a status was actually requested -- see
  // canAttemptSubmission below for how that is kept backward compatible.
  const isAvailabilityKnown = isAvailable !== undefined || isCheckingAvailability !== undefined;
  const blockedByAvailability = isAvailabilityKnown && (isCheckingAvailability === true || isAvailable !== true);

  // Guards EVERY path that can start a new question -- the form's submit
  // event, the Enter key, and the suggestion buttons all funnel through
  // here, so a disabled attribute alone is never the only defence. This
  // also stops a stale UI state (e.g. a suggestion click dispatched in the
  // same tick availability flipped) from reaching submitQuestion().
  const attemptSubmit = () => {
    if (blockedByAvailability) return;
    submitQuestion();
  };

  const handleClose = () => {
    if (typeof onClose === "function") onClose();
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    attemptSubmit();
  };

  const handleKeyDown = (event) => {
    // Enter sends; Shift+Enter inserts a newline in this multiline
    // composer.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      attemptSubmit();
    }
  };

  const handleSuggestion = (text) => {
    // Populates the composer and focuses it -- never submits on the user's
    // behalf, so the question can still be edited. Blocked entirely while
    // unavailable so it cannot populate a composer the user then cannot
    // send from.
    if (blockedByAvailability) return;
    setInput(text);
    if (composerRef.current) composerRef.current.focus();
  };

  const handleRetryAvailability = () => {
    if (typeof onRetryAvailability === "function") onRetryAvailability();
  };

  const handleSelectSession = (sessionId) => {
    setHistoryLoadError(null);
    selectHistorySession(sessionId);
  };

  const handleBackToConversation = () => {
    setHistoryLoadError(null);
    setMode(PANEL_MODE.CONVERSATION);
    selectHistorySession(null);
  };

  const trimmedLength = input.trim().length;
  const isOverLimit = trimmedLength > MAX_QUESTION_LENGTH;
  const showSuggestions = messages.length === 0 && !pending && !failed && mode === PANEL_MODE.CONVERSATION;

  // Batch 3E: the composer is disabled while a request is in flight (the
  // pre-existing isBusy rule) OR while availability is unknown/false. The
  // Ask button additionally keeps its existing canSubmit rules.
  const composerDisabled = isBusy || blockedByAvailability;
  const submitDisabled = !canSubmit || blockedByAvailability;

  // Exactly one of these ever renders, and only when a status is actually
  // being tracked. Deliberately generic: no provider, model, env-var name,
  // or reason code is available to this component in the first place (the
  // server never sends one), so there is nothing here that could leak.
  const availabilityNotice = !isAvailabilityKnown
    ? null
    : isCheckingAvailability === true
    ? "Checking SIA availability…"
    : isAvailable !== true
    ? "SIA is temporarily unavailable. You can still view previous conversations."
    : null;

  return (
    <div className="sia-panel" role="dialog" aria-modal="false" aria-labelledby="sia-panel-heading">
      <div className="sia-panel-header">
        <h2 id="sia-panel-heading" className="sia-panel-heading">
          Ask SIA
        </h2>
        <div className="sia-header-actions">
          <button
            type="button"
            className="sia-header-btn"
            onClick={newChat}
            disabled={isBusy}
            aria-label="Start a new conversation"
          >
            New chat
          </button>
          <button
            type="button"
            className="sia-header-btn"
            onClick={() =>
              setMode(mode === PANEL_MODE.HISTORY ? PANEL_MODE.CONVERSATION : PANEL_MODE.HISTORY)
            }
            disabled={isBusy}
            aria-label="Conversation history"
          >
            History
          </button>
          <button
            type="button"
            className="sia-panel-close"
            aria-label="Close SIA"
            onClick={handleClose}
            ref={closeButtonRef}
          >
            &times;
          </button>
        </div>
      </div>

      {mode === PANEL_MODE.HISTORY ? (
        <>
          {historyLoadError && (
            <p className="sia-error sia-history-error" role="alert">
              {historyLoadError}
            </p>
          )}
          <SiaSessionList
            isOpen
            activeSessionId={activeSessionId}
            onSelect={handleSelectSession}
            onBack={handleBackToConversation}
            onActiveSessionDeleted={clearActiveSession}
          />
        </>
      ) : (
        <>
          {/* Batch 3E availability notice. aria-live="polite" so a screen
              reader announces the transition from checking -> available/
              unavailable without interrupting, and the Retry control is
              offered only once checking has actually finished. */}
          {availabilityNotice && (
            <div className="sia-availability-notice" role="status" aria-live="polite">
              <p className="sia-availability-text">{availabilityNotice}</p>
              {isCheckingAvailability !== true && (
                <button
                  type="button"
                  className="sia-secondary-btn"
                  onClick={handleRetryAvailability}
                >
                  Retry
                </button>
              )}
            </div>
          )}

          <div className="sia-transcript" role="log" aria-label="Conversation">
            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "user" ? "sia-message sia-message-user" : "sia-message sia-message-assistant"
                }
              >
                <span className="sia-visually-hidden">
                  {message.role === "user" ? "You said:" : "SIA said:"}
                </span>
                <p className="sia-message-text">{message.content}</p>

                {/* Batch 3F: only ever considered for an assistant turn --
                    a user message's `grounding` is never set in the first
                    place, but the role check here is an explicit second
                    guard, matching this file's existing defence-in-depth
                    style (see blockedByAvailability above). */}
                {message.role === "assistant" && <SiaGroundingDisclosure grounding={message.grounding} />}

                {failed && failed.messageId === message.id && (
                  <div className="sia-error-block">
                    <p className="sia-error" role="alert">
                      {failed.code === SIA_ERROR_CODE.IN_PROGRESS
                        ? "This question is still being processed. You can try again in a moment."
                        : failed.code === SIA_ERROR_CODE.CONFLICT
                        ? "This question could not be retried safely. Please dismiss it and ask again."
                        : failed.message}
                    </p>
                    {/* A conflict can never be resolved by resending the
                        same key, so Retry is deliberately not offered for
                        it -- only a deliberate fresh submission can. */}
                    {failed.code !== SIA_ERROR_CODE.CONFLICT && (
                      <button type="button" className="sia-secondary-btn" onClick={retry}>
                        Retry
                      </button>
                    )}
                    <button type="button" className="sia-secondary-btn" onClick={dismissFailed}>
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            ))}

            {pending && (
              <p className="sia-pending" role="status">
                SIA is thinking&hellip;
              </p>
            )}

            <div ref={transcriptEndRef} />
          </div>

          {showSuggestions && (
            <div className="sia-suggestions">
              <p className="sia-suggestions-label">Try asking:</p>
              <ul className="sia-suggestion-list">
                {SIA_SUGGESTIONS.map((suggestion) => (
                  <li key={suggestion.id}>
                    <button
                      type="button"
                      className="sia-suggestion"
                      onClick={() => handleSuggestion(suggestion.text)}
                      disabled={blockedByAvailability}
                    >
                      {suggestion.text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <form className="sia-composer" onSubmit={handleSubmit}>
            <label htmlFor="sia-question-input" className="sia-panel-label">
              Your question
            </label>
            <textarea
              id="sia-question-input"
              className="sia-panel-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={composerDisabled}
              rows={2}
              ref={composerRef}
            />
            <div className="sia-composer-footer">
              {/* Only surfaces near the limit rather than counting from
                  zero, so it is information when it matters and noise
                  never. */}
              {trimmedLength > MAX_QUESTION_LENGTH - 100 && (
                <span className={isOverLimit ? "sia-counter sia-counter-over" : "sia-counter"} role="status">
                  {trimmedLength} / {MAX_QUESTION_LENGTH}
                </span>
              )}
              <button type="submit" className="sia-panel-submit" disabled={submitDisabled}>
                Ask
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
};

export default SiaPanel;
