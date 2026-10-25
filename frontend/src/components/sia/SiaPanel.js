import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FiClock, FiPlus, FiSend, FiX, FiChevronRight } from "react-icons/fi";
import { FaChartBar, FaChartPie, FaChartLine, FaRupeeSign, FaBullseye, FaExclamationCircle, FaWallet } from "react-icons/fa";
import { HiSparkles } from "react-icons/hi2";
import SiaSessionList from "./SiaSessionList";
import SiaGroundingDisclosure from "./SiaGroundingDisclosure";
import SiaVoiceRecorderControls from "./SiaVoiceRecorderControls";
import SiaSpeakButton from "./SiaSpeakButton";
import { useSiaVoiceRecorder, SIA_RECORDER_STATE } from "./useSiaVoiceRecorder";
import { insertTranscriptIntoComposer } from "./siaTranscriptInsertion";
import { SIA_SUGGESTIONS } from "./siaSuggestions";
import { renderSiaAnswer } from "./siaAnswerRenderer";
import { useSiaSessionMessagesQuery } from "../../hooks/queries/useSiaSessionMessagesQuery";
import { queryKeys } from "../../query/queryKeys";
import { useIsMobile } from "../hooks/useIsMobile";
import {
  PANEL_MODE,
  SIA_ERROR_CODE,
  MAX_QUESTION_LENGTH,
  normalizeServerMessages,
} from "./useSiaConversation";
// FE-003-T04 -- SiaPanel.css is imported eagerly by SiaEntryPoint.js instead
// of here, because it also styles the always-rendered .sia-root/
// .sia-entry-point launcher; this file (SiaPanel.js itself) is now the lazy
// chunk, and the launcher must not lose its styling before that chunk loads.

// Workstream 3, part A: recorder states in which a recording or an
const VOICE_ACTIVE_STATES = new Set([
  SIA_RECORDER_STATE.REQUESTING_PERMISSION,
  SIA_RECORDER_STATE.RECORDING,
  SIA_RECORDER_STATE.STOPPING,
  SIA_RECORDER_STATE.TRANSCRIBING,
  SIA_RECORDER_STATE.TOO_LONG,
]);

// The legacy semantic path returns one `periodLabel`; the grounded v2 path
function getPlanSummaryLabel(planSummary) {
  if (!planSummary || typeof planSummary !== "object") return null;
  if (typeof planSummary.periodLabel === "string" && planSummary.periodLabel.trim() !== "") {
    return planSummary.periodLabel.trim();
  }
  return null;
}


function getSuggestionIcon(id) {
  switch (id) {
    case "spending-current":
      return <FaChartBar />;
    case "category-highest":
      return <FaChartPie />;
    case "comparison-month":
      return <FaChartLine />;
    case "income-expenses":
      return <FaRupeeSign />;
    case "budget-track":
      return <FaBullseye />;
    case "spending-trend":
      return <FaChartLine />;
    case "unusual-recent":
      return <FaExclamationCircle />;
    case "cash-flow":
      return <FaWallet />;
    default:
      return <FaChartBar />;
  }
}

function formatMessageTime(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  if (isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function getInterpretationLabel(interpretation) {
  if (!interpretation || typeof interpretation !== "object") return null;
  if (typeof interpretation.periodLabel === "string" && interpretation.periodLabel.trim() !== "") {
    return interpretation.periodLabel.trim();
  }
  if (!Array.isArray(interpretation.periodLabels)) return null;
  const labels = interpretation.periodLabels
    .filter((label) => typeof label === "string" && label.trim() !== "")
    .map((label) => label.trim());
  return labels.length > 0 ? labels.join(", ") : null;
}


// Presentation only. Every piece of conversation state lives in
const SiaPanel = ({
  onClose,
  conversation,
  isAvailable,
  isCheckingAvailability,
  // FE-001-T08 -- distinguishes a genuine status-query failure from a
  // clean "available: false" response for the notice copy below only;
  // blockedByAvailability's fail-closed gate is unchanged.
  isAvailabilityError,
  onRetryAvailability,
  focusRequestVersion,
  lastHandledFocusRequestVersionRef,
  // Workstream 3: GET /sia/status's additive `capabilities.voiceInput`
  voiceCapabilities,
}) => {
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
    submitClarificationOption,
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
  const isMobile = useIsMobile(600);
  const retryButtonRef = useRef(null);
  const firstClarificationOptionRef = useRef(null);
  const lastFocusedClarificationMessageIdRef = useRef(null);
  const [voiceInsertError, setVoiceInsertError] = useState(null);

  // Workstream 3, part A/C: fail-closed exactly like the text-availability
  const voiceAvailable = voiceCapabilities?.available === true;
  const voiceRecorder = useSiaVoiceRecorder({
    maxDurationSeconds: voiceCapabilities?.maxDurationSeconds,
  });
  // Batch 3G remediation: fallback acknowledgement store for callers that
  const localLastHandledFocusRequestVersionRef = useRef(0);
  const lastHandledRef = lastHandledFocusRequestVersionRef || localLastHandledFocusRequestVersionRef;
  const queryClient = useQueryClient();
  const [historyLoadError, setHistoryLoadError] = useState(null);

  // Only fetches once a session is actually selected.
  const messagesQuery = useSiaSessionMessagesQuery(selectedHistorySessionId);

  // A failed load (typically a 404 for a session deleted elsewhere) returns
  useEffect(() => {
    if (!selectedHistorySessionId || !messagesQuery.isError) return;
    setHistoryLoadError("That conversation could not be opened. It may have been deleted.");
    selectHistorySession(null);
    queryClient.invalidateQueries({ queryKey: queryKeys.sia.sessions.list() });
  }, [selectedHistorySessionId, messagesQuery.isError, selectHistorySession, queryClient]);

  // Hydrate exactly once per successful load, and only for the session
  useEffect(() => {
    if (!selectedHistorySessionId || !messagesQuery.isSuccess) return;
    const loadedSessionId = messagesQuery.data?.sessionId || selectedHistorySessionId;
    if (String(loadedSessionId) !== String(selectedHistorySessionId)) return;
    hydrate(selectedHistorySessionId, normalizeServerMessages(messagesQuery.data?.messages));
  }, [selectedHistorySessionId, messagesQuery.isSuccess, messagesQuery.data, hydrate]);

  // Opening the mobile panel must not summon the virtual keyboard. Keep the
  useEffect(() => {
    if (mode !== PANEL_MODE.CONVERSATION) return;
    if (isMobile) {
      if (closeButtonRef.current) closeButtonRef.current.focus();
    } else if (composerRef.current) {
      composerRef.current.focus();
    }
  }, [mode, isMobile]);

  // The scroll-to-top control is mounted outside the authenticated app tree,
  useEffect(() => {
    if (!isMobile || typeof document === "undefined") return undefined;
    document.body.classList.add("sia-mobile-panel-open");
    return () => document.body.classList.remove("sia-mobile-panel-open");
  }, [isMobile]);

  // Follow the newest message on submit/answer. Guarded because jsdom (and
  // some older browsers) do not implement scrollIntoView.
  useEffect(() => {
    if (transcriptEndRef.current?.scrollIntoView) {
      transcriptEndRef.current.scrollIntoView({ block: "end" });
    }
  }, [messages.length, pending]);

  // Workstream 3, part C: the SINGLE place a voice transcript is ever
  useEffect(() => {
    if (voiceRecorder.state !== SIA_RECORDER_STATE.REVIEW_READY) return;

    const result = insertTranscriptIntoComposer(input, voiceRecorder.transcript);
    if (result.ok) {
      setVoiceInsertError(null);
      setInput(result.value);
    } else {
      // The composer's existing draft is left completely untouched -- only
      setVoiceInsertError(result.error);
    }
    voiceRecorder.reset();
    if (composerRef.current) composerRef.current.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceRecorder.state]);

  // A fresh recording attempt (mic pressed again) clears any previous
  useEffect(() => {
    if (voiceRecorder.state === SIA_RECORDER_STATE.RECORDING) {
      setVoiceInsertError(null);
    }
  }, [voiceRecorder.state]);

  // Workstream 3, part E: focuses the first clarification option as soon
  useEffect(() => {
    const last = messages[messages.length - 1];
    const isNewClarification =
      last &&
      last.role === "assistant" &&
      last.kind === "clarification" &&
      lastFocusedClarificationMessageIdRef.current !== last.id;

    if (isNewClarification && firstClarificationOptionRef.current) {
      lastFocusedClarificationMessageIdRef.current = last.id;
      firstClarificationOptionRef.current.focus();
    }
  }, [messages]);

  // Batch 3E: the single fail-closed gate every submission route consults.
  const isAvailabilityKnown = isAvailable !== undefined || isCheckingAvailability !== undefined;
  const blockedByAvailability = isAvailabilityKnown && (isCheckingAvailability === true || isAvailable !== true);

  // Guards EVERY path that can start a new question -- the form's submit
  const attemptSubmit = () => {
    if (blockedByAvailability) return;
    submitQuestion();
  };

  const handleClose = () => {
    // Workstream 3, part A: a close (including via Escape's fallback path
    // below) must never leave a recording running or an upload in flight.
    voiceRecorder.cancel();
    if (typeof onClose === "function") onClose();
  };

  // Workstream 3, part E: Escape closes the panel UNLESS a recording is
  const handlePanelKeyDown = (event) => {
    if (event.key !== "Escape") return;
    if (VOICE_ACTIVE_STATES.has(voiceRecorder.state)) {
      event.stopPropagation();
      voiceRecorder.cancel();
      return;
    }
    handleClose();
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
  const composerDisabled = isBusy || blockedByAvailability;
  const submitDisabled = !canSubmit || blockedByAvailability;

  // Batch 3G: the explicit contextual-launch focus signal (see
  useEffect(() => {
    if (!focusRequestVersion) return;
    if (focusRequestVersion <= lastHandledRef.current) return;
    lastHandledRef.current = focusRequestVersion;

    if (composerDisabled) {
      // The composer itself cannot take focus while disabled -- prefer the
      if (isCheckingAvailability !== true && retryButtonRef.current) {
        retryButtonRef.current.focus();
      } else if (closeButtonRef.current) {
        closeButtonRef.current.focus();
      }
    } else if (composerRef.current) {
      composerRef.current.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequestVersion]);

  // Exactly one of these ever renders, and only when a status is actually
  const availabilityNotice = !isAvailabilityKnown
    ? null
    : isCheckingAvailability === true
    ? "Checking SIA availability…"
    : isAvailable !== true
    ? isAvailabilityError
      ? "Couldn't check SIA's availability right now. You can still view previous conversations."
      : "SIA is temporarily unavailable. You can still view previous conversations."
    : null;

  // Workstream 3, part A: New chat and switching to History both leave the
  const handleNewChat = () => {
    voiceRecorder.cancel();
    newChat();
  };
  const handleToggleHistory = () => {
    voiceRecorder.cancel();
    setMode(mode === PANEL_MODE.HISTORY ? PANEL_MODE.CONVERSATION : PANEL_MODE.HISTORY);
  };

  return (
    <div
      className="sia-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="sia-panel-heading"
      onKeyDown={handlePanelKeyDown}
    >
      <div className="sia-panel-header">
        <div className="sia-panel-brand">
          <span className="sia-brand-mark" aria-hidden="true">
            <HiSparkles />
          </span>
          <h2 id="sia-panel-heading" className="sia-panel-heading">
            Ask SIA
          </h2>
        </div>
        <div className="sia-header-actions">
          <button
            type="button"
            className="sia-header-btn"
            onClick={handleNewChat}
            disabled={isBusy}
            aria-label="Start a new conversation"
            title="New chat"
          >
            <FiPlus aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`sia-header-btn ${mode === PANEL_MODE.HISTORY ? "sia-header-btn-active" : ""}`}
            onClick={handleToggleHistory}
            disabled={isBusy}
            aria-label="Conversation history"
            aria-pressed={mode === PANEL_MODE.HISTORY}
            title="History"
          >
            <FiClock aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sia-panel-close sia-header-btn"
            aria-label="Close SIA"
            title="Close"
            onClick={handleClose}
            ref={closeButtonRef}
          >
            <FiX aria-hidden="true" />
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
          {/* FE-001-T08 -- selecting a session sets selectedHistorySessionId
              but `mode` stays HISTORY until messagesQuery actually succeeds
              (see HYDRATE in useSiaConversation.js), so without this the
              list gave no indication a session was opening at all.
              messagesQuery.isLoading (not isFetching) so re-opening an
              already-cached session doesn't flash this needlessly. */}
          {selectedHistorySessionId && messagesQuery.isLoading && (
            <p className="sia-muted sia-history-opening" role="status" aria-live="polite">
              Opening conversation&hellip;
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
                  ref={retryButtonRef}
                >
                  Retry
                </button>
              )}
            </div>
          )}

          <div className="sia-transcript" role="log" aria-label="Conversation">
            {/* Layout fix: suggestions render INSIDE the same scrollable
                region as the message list (rather than as a separate
                non-scrolling sibling below it) so a short viewport scrolls
                them together with the empty state instead of having them
                overflow the panel's fixed max-height. Only ever shown when
                messages.length === 0, so this never reorders anything
                relative to real conversation content. */}
            {showSuggestions && (
              <div className="sia-suggestions">
                <div className="sia-welcome">
                  <div className="sia-welcome-content">
                    <h3 className="sia-welcome-title">Make sense of your money</h3>
                    <p className="sia-welcome-copy">
                      Ask about your spending, budget, forecasts, or financial risks.
                    </p>
                  </div>
                  <div className="sia-welcome-art" aria-hidden="true">
                    <svg width="68" height="68" viewBox="0 0 68 68" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="34" cy="34" r="32" fill="url(#siaWelcomeGlow)" />
                      <rect x="20" y="34" width="7" height="18" rx="3.5" fill="#e11d48" fillOpacity="0.75" />
                      <rect x="30.5" y="24" width="7" height="28" rx="3.5" fill="#d81b60" fillOpacity="0.85" />
                      <rect x="41" y="16" width="7" height="36" rx="3.5" fill="#c2185b" />
                      <path d="M53 11L54.5 15L58.5 16.5L54.5 18L53 22L51.5 18L47.5 16.5L51.5 15L53 11Z" fill="#e11d48" />
                      <path d="M19 44L20 46L22 47L20 48L19 50L18 48L16 47L18 46L19 44Z" fill="#e11d48" fillOpacity="0.6" />
                      <defs>
                        <radialGradient id="siaWelcomeGlow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(34 34) scale(32)">
                          <stop stopColor="#f472b6" stopOpacity="0.32" />
                          <stop offset="1" stopColor="#ffe4e6" stopOpacity="0.04" />
                        </radialGradient>
                      </defs>
                    </svg>
                  </div>
                </div>
                <p className="sia-suggestions-label">Popular questions</p>
                <ul className="sia-suggestion-list">
                  {SIA_SUGGESTIONS.map((suggestion) => (
                    <li key={suggestion.id}>
                      <button
                        type="button"
                        className="sia-suggestion"
                        onClick={() => handleSuggestion(suggestion.text)}
                        disabled={blockedByAvailability}
                      >
                        <span className="sia-suggestion-icon-badge" aria-hidden="true">
                          {getSuggestionIcon(suggestion.id)}
                        </span>
                        <span className="sia-suggestion-text">{suggestion.text}</span>
                        <FiChevronRight className="sia-suggestion-arrow" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {messages.map((message, index) => {
              const isClarification = message.role === "assistant" && message.kind === "clarification";
              const isLastMessage = index === messages.length - 1;
              const interpretationLabel = getInterpretationLabel(message.interpretation);
              const planSummaryLabel = getPlanSummaryLabel(message.planSummary);
              const formattedTime = formatMessageTime(message.createdAt);

              return (
              <div
                key={message.id}
                className={
                  message.role === "user" ? "sia-message sia-message-user" : "sia-message sia-message-assistant"
                }
              >
                {message.role === "assistant" && (
                  <div className="sia-message-avatar" aria-hidden="true">
                    <HiSparkles />
                  </div>
                )}

                <div className="sia-message-bubble">
                  <span className="sia-visually-hidden">
                    {message.role === "user" ? "You said:" : "SIA said:"}
                  </span>
                  {message.role === "assistant" ? (
                    <div className="sia-message-text sia-markdown">{renderSiaAnswer(message.content)}</div>
                  ) : (
                    <p className="sia-message-text">{message.content}</p>
                  )}

                  {message.role === "assistant" &&
                    !isClarification &&
                    (planSummaryLabel ? (
                      <p className="sia-interpretation">Using {planSummaryLabel}</p>
                    ) : (
                      interpretationLabel && <p className="sia-interpretation">Using {interpretationLabel}</p>
                    ))}

                  {isClarification && (
                    <div className="sia-clarification-options" role="group" aria-label="Clarification options">
                      <ul className="sia-clarification-option-list">
                        {message.options.map((option, optionIndex) => (
                          <li key={option.id ?? option.label}>
                            <button
                              type="button"
                              className="sia-suggestion sia-clarification-option"
                              onClick={() => {
                                if (blockedByAvailability) return;
                                submitClarificationOption(option);
                              }}
                              disabled={blockedByAvailability || isBusy}
                              ref={isLastMessage && optionIndex === 0 ? firstClarificationOptionRef : undefined}
                            >
                              {option.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {message.role === "assistant" && <SiaGroundingDisclosure grounding={message.grounding} />}

                  {message.role === "assistant" && !isClarification && (
                    <div className="sia-message-actions">
                      <SiaSpeakButton text={message.content} stopSignal={`${activeSessionId || ""}:${pending ? "pending" : "idle"}:${mode}`} />
                    </div>
                  )}

                  <div className="sia-message-footer">
                    <span className="sia-message-time">{formattedTime}</span>
                    {message.role === "user" && (
                      <span className="sia-message-status" aria-hidden="true">✓✓</span>
                    )}
                  </div>
                </div>

                {failed && failed.messageId === message.id && (
                  <div className="sia-error-block">
                    <p className="sia-error" role="alert">
                      {failed.code === SIA_ERROR_CODE.IN_PROGRESS
                        ? "This question is still being processed. You can try again in a moment."
                        : failed.code === SIA_ERROR_CODE.CONFLICT
                        ? "This question could not be retried safely. Please dismiss it and ask again."
                        : failed.message}
                    </p>
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
              );
            })}

            {pending && (
              <div className="sia-message sia-message-assistant sia-message-pending" role="status">
                <div className="sia-message-avatar" aria-hidden="true">
                  <HiSparkles />
                </div>
                <div className="sia-message-bubble sia-pending-bubble">
                  <span className="sia-visually-hidden">SIA is thinking</span>
                  <span className="sia-thinking-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              </div>
            )}

            <div ref={transcriptEndRef} />
          </div>

          <form className="sia-composer" onSubmit={handleSubmit}>
            <label htmlFor="sia-question-input" className="sia-visually-hidden">
              Your question
            </label>
            <div className="sia-composer-box">
              <textarea
                id="sia-question-input"
                className="sia-panel-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={composerDisabled}
                rows={1}
                placeholder="Ask about your spending, budget, or trends…"
                ref={composerRef}
              />

              <div className="sia-composer-actions">
                {voiceAvailable && (
                  <SiaVoiceRecorderControls recorder={voiceRecorder} disabled={composerDisabled} />
                )}
                <button
                  type="submit"
                  className="sia-panel-submit"
                  disabled={submitDisabled}
                  aria-label="Ask"
                  title="Ask"
                >
                  <FiSend aria-hidden="true" />
                  <span className="sia-visually-hidden">Ask</span>
                </button>
              </div>
            </div>

            {trimmedLength > MAX_QUESTION_LENGTH - 100 && (
              <div className="sia-composer-meta">
                <span className={isOverLimit ? "sia-counter sia-counter-over" : "sia-counter"} role="status">
                  {trimmedLength} / {MAX_QUESTION_LENGTH}
                </span>
              </div>
            )}

            {voiceInsertError && (
              <p className="sia-error sia-voice-insert-error" role="alert">
                {voiceInsertError}
              </p>
            )}

          </form>
        </>
      )}
    </div>
  );
};

export default SiaPanel;
