import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FiArrowUpRight, FiClock, FiPlus, FiSend, FiX } from "react-icons/fi";
import { HiSparkles } from "react-icons/hi2";
import SiaSessionList from "./SiaSessionList";
import SiaGroundingDisclosure from "./SiaGroundingDisclosure";
import SiaVoiceRecorderControls from "./SiaVoiceRecorderControls";
import SiaSpeakButton from "./SiaSpeakButton";
import { useSiaVoiceRecorder, SIA_RECORDER_STATE } from "./useSiaVoiceRecorder";
import { insertTranscriptIntoComposer } from "./siaTranscriptInsertion";
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

// Workstream 3, part A: recorder states in which a recording or an
// in-flight transcription upload is actually active -- used both to gate
// Escape's cancel-first precedence and to decide whether New chat/history
// navigation/close should cancel the recorder before proceeding.
const VOICE_ACTIVE_STATES = new Set([
  SIA_RECORDER_STATE.REQUESTING_PERMISSION,
  SIA_RECORDER_STATE.RECORDING,
  SIA_RECORDER_STATE.STOPPING,
  SIA_RECORDER_STATE.TRANSCRIBING,
  SIA_RECORDER_STATE.TOO_LONG,
]);

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
const SiaPanel = ({
  onClose,
  conversation,
  isAvailable,
  isCheckingAvailability,
  onRetryAvailability,
  focusRequestVersion,
  lastHandledFocusRequestVersionRef,
  // Workstream 3: GET /sia/status's additive `capabilities.voiceInput`
  // block (see backend/Controllers/SiaControllers/status.js), passed
  // through unchanged from whatever already reads SIA status
  // (SiaEntryPoint's useSiaStatusQuery). Optional -- every existing caller
  // that renders SiaPanel without it (including this file's own tests)
  // simply never shows voice controls, exactly like the unsupported-browser
  // case.
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
  const retryButtonRef = useRef(null);
  const firstClarificationOptionRef = useRef(null);
  const lastFocusedClarificationMessageIdRef = useRef(null);
  const [voiceInsertError, setVoiceInsertError] = useState(null);

  // Workstream 3, part A/C: fail-closed exactly like the text-availability
  // gate above -- voice controls render only once the backend has
  // confirmed voice input is actually ready, never optimistically while
  // capabilities are still loading or absent.
  const voiceAvailable = voiceCapabilities?.available === true;
  const voiceRecorder = useSiaVoiceRecorder({
    maxDurationSeconds: voiceCapabilities?.maxDurationSeconds,
  });
  // Batch 3G remediation: fallback acknowledgement store for callers that
  // render SiaPanel directly without the owner-supplied ref (e.g. older
  // tests) -- SiaPanel itself still unmounts/remounts in that case, so this
  // local ref does NOT survive close/reopen on its own, matching the
  // pre-remediation behavior for exactly those callers. Whenever
  // SiaEntryPoint renders this component (the only production caller), the
  // real prop below is used instead, and THAT ref survives unmounts.
  const localLastHandledFocusRequestVersionRef = useRef(0);
  const lastHandledRef = lastHandledFocusRequestVersionRef || localLastHandledFocusRequestVersionRef;
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

  // Workstream 3, part C: the SINGLE place a voice transcript is ever
  // inserted into the composer -- fires exactly once per completed
  // recording, because `voiceRecorder.reset()` immediately flips
  // `voiceRecorder.state` away from REVIEW_READY again, which is this
  // effect's own dependency, so a re-render can never re-run it for the
  // same transcript. Never auto-submits: only setInput/focus, never
  // submitQuestion.
  useEffect(() => {
    if (voiceRecorder.state !== SIA_RECORDER_STATE.REVIEW_READY) return;

    const result = insertTranscriptIntoComposer(input, voiceRecorder.transcript);
    if (result.ok) {
      setVoiceInsertError(null);
      setInput(result.value);
    } else {
      // The composer's existing draft is left completely untouched -- only
      // an inline, accessible notice is shown so the user can decide what
      // to do next.
      setVoiceInsertError(result.error);
    }
    voiceRecorder.reset();
    if (composerRef.current) composerRef.current.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceRecorder.state]);

  // A fresh recording attempt (mic pressed again) clears any previous
  // insert-rejected notice so it never lingers describing a now-irrelevant
  // attempt.
  useEffect(() => {
    if (voiceRecorder.state === SIA_RECORDER_STATE.RECORDING) {
      setVoiceInsertError(null);
    }
  }, [voiceRecorder.state]);

  // Workstream 3, part E: focuses the first clarification option as soon
  // as one is rendered -- guarded by message id so this never re-steals
  // focus on an unrelated re-render of the same transcript.
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
    // Workstream 3, part A: a close (including via Escape's fallback path
    // below) must never leave a recording running or an upload in flight.
    voiceRecorder.cancel();
    if (typeof onClose === "function") onClose();
  };

  // Workstream 3, part E: Escape closes the panel UNLESS a recording is
  // actively in progress, in which case Escape cancels the recording FIRST
  // and leaves the panel open -- a second Escape press (nothing active
  // anymore) then closes it normally. stopPropagation prevents any outer
  // modal/router-level Escape handler from also firing on the same
  // keypress.
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

  // Batch 3G: the explicit contextual-launch focus signal (see
  // SiaEntryPoint.js's openWithSuggestion, which increments this prop on
  // every valid contextual click). The mode-keyed effect above does NOT
  // reliably refire here -- a contextual click on an already-open panel
  // that is already in conversation mode never changes `mode` at all, and
  // neither does a second click on a different contextual button while the
  // first click's prefilled text is still showing. `focusRequestVersion` is
  // a value that changes on every single valid contextual launch
  // specifically so this effect can key on it directly, independent of
  // whatever else did or didn't change.
  //
  // `focusRequestVersion` starts at 0/undefined and is otherwise untouched
  // by hydration, message updates, or availability refetches -- so this
  // never fires on ordinary mount, session restoration, or unrelated
  // re-renders, only on a genuine contextual launch.
  //
  // Batch 3G remediation: a version is only ever processed once. Without
  // this guard, closing the panel (which unmounts SiaPanel) and then
  // reopening it ordinarily (via the plain "Ask SIA" button, not a new
  // contextual click) would re-run this effect on the fresh mount with the
  // SAME already-consumed `focusRequestVersion` value still in
  // SiaEntryPoint's state, incorrectly replaying the contextual focus
  // behavior for a plain open. `lastHandledRef` (see above) survives that
  // unmount/remount when SiaEntryPoint supplies it, so a version already
  // acknowledged is never processed twice. Marking the version handled
  // BEFORE focusing (rather than after) means a synchronous re-render
  // triggered by the focus call itself can never re-enter this branch.
  useEffect(() => {
    if (!focusRequestVersion) return;
    if (focusRequestVersion <= lastHandledRef.current) return;
    lastHandledRef.current = focusRequestVersion;

    if (composerDisabled) {
      // The composer itself cannot take focus while disabled -- prefer the
      // Retry control when one is actually being offered, otherwise fall
      // back to the panel's own close control rather than a disabled
      // element.
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

  // Workstream 3, part A: New chat and switching to History both leave the
  // panel mounted (unlike Close), so an active recording/upload would
  // otherwise keep running silently behind the now-reset/hidden composer.
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
            className="sia-panel-close"
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
                  <span className="sia-welcome-icon" aria-hidden="true">
                    <HiSparkles />
                  </span>
                  <div>
                    <h3 className="sia-welcome-title">Make sense of your money</h3>
                    <p className="sia-welcome-copy">
                      Ask about your spending, budget, forecasts, or financial risks.
                    </p>
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
                        <span>{suggestion.text}</span>
                        <FiArrowUpRight aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {messages.map((message, index) => {
              const isClarification = message.role === "assistant" && message.kind === "clarification";
              const isLastMessage = index === messages.length - 1;
              return (
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

                {/* Workstream 3, part D: a small, human-readable trust
                    label derived ONLY from interpretation.periodLabel
                    (already plain text, e.g. "this month" -- see
                    backend/sia/periodResolver.js) -- metrics/internal ids
                    are never rendered here or anywhere else. */}
                {message.role === "assistant" &&
                  !isClarification &&
                  typeof message.interpretation?.periodLabel === "string" &&
                  message.interpretation.periodLabel.trim() !== "" && (
                    <p className="sia-interpretation">Using {message.interpretation.periodLabel}</p>
                  )}

                {/* Workstream 3, part D: each clarification option is its
                    own accessible button. Clicking one re-submits through
                    conversation.submitClarificationOption -- the EXACT
                    same ask-mutation path a typed follow-up uses, never a
                    one-off fetch. */}
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

                {/* Batch 3F: only ever considered for an assistant turn --
                    a user message's `grounding` is never set in the first
                    place, but the role check here is an explicit second
                    guard, matching this file's existing defence-in-depth
                    style (see blockedByAvailability above). */}
                {message.role === "assistant" && <SiaGroundingDisclosure grounding={message.grounding} />}

                {/* Workstream 3, part F: speaks ONLY this message's own
                    rendered answer text -- never grounding internals,
                    interpretation metadata, or (for a clarification) the
                    option list as a batch. Renders nothing when
                    speechSynthesis is unsupported. `stopSignal` changes
                    whenever the active conversation identity changes (a
                    new pending question, a mode switch, or the whole panel
                    unmounting via onClose), which is this component's one
                    cleanup trigger for every "stop speaking" case. */}
                {message.role === "assistant" && !isClarification && (
                  <SiaSpeakButton text={message.content} stopSignal={`${activeSessionId || ""}:${pending ? "pending" : "idle"}:${mode}`} />
                )}

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
              );
            })}

            {pending && (
              <p className="sia-pending" role="status">
                <span className="sia-thinking-mark" aria-hidden="true">
                  <HiSparkles />
                </span>
                <span>SIA is thinking</span>
                <span className="sia-thinking-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              </p>
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

              <div className="sia-composer-footer">
                {/* Only surfaces near the limit rather than counting from
                    zero, so it is information when it matters and noise
                    never. */}
                <div className="sia-composer-meta">
                  {trimmedLength > MAX_QUESTION_LENGTH - 100 && (
                    <span className={isOverLimit ? "sia-counter sia-counter-over" : "sia-counter"} role="status">
                      {trimmedLength} / {MAX_QUESTION_LENGTH}
                    </span>
                  )}
                </div>

                <div className="sia-composer-actions">
                  {/* Workstream 3, part C: renders nothing at all when the
                      browser can't record (SIA_RECORDER_STATE.UNSUPPORTED
                      path) or when the backend has not confirmed voice input. */}
                  {voiceAvailable && (
                    <SiaVoiceRecorderControls recorder={voiceRecorder} disabled={composerDisabled} />
                  )}
                  <button type="submit" className="sia-panel-submit" disabled={submitDisabled}>
                    <span>Ask</span>
                    <FiSend aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>

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
