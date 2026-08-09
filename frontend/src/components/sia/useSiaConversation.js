import { useCallback, useMemo, useReducer } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSiaAskMutation } from "../../hooks/mutations/useSiaAskMutation";
import { createClientMessageId } from "../../utils/createClientMessageId";
import { queryKeys } from "../../query/queryKeys";

// Owns the entire SIA conversation. Deliberately a reducer rather than a
// pile of useState calls: sending, succeeding, failing, retrying,
// hydrating from history and starting a new chat each move several fields
// at once, and those fields must never drift out of step with each other
// (a pending request with no visible user turn, or a failed request whose
// key was silently replaced, are exactly the bugs this shape prevents).
//
// This hook is mounted by SiaEntryPoint, NOT by SiaPanel, so closing the
// panel unmounts only the presentation -- the transcript, active session
// and any in-flight request survive until the page itself is remounted.
// Nothing here touches localStorage/sessionStorage: a refresh is meant to
// start a fresh local conversation, with server-side history as the
// explicit recovery path.

export const PANEL_MODE = Object.freeze({
  CONVERSATION: "conversation",
  HISTORY: "history",
});

// Backend error codes that need distinct local handling (see
// backend/Controllers/SiaControllers/ask.js).
export const SIA_ERROR_CODE = Object.freeze({
  IN_PROGRESS: "SIA_REQUEST_IN_PROGRESS",
  CONFLICT: "SIA_IDEMPOTENCY_CONFLICT",
});

const GENERIC_ERROR_MESSAGE = "SIA is temporarily unavailable. Please try again.";

export const initialState = {
  activeSessionId: null,
  messages: [],
  input: "",
  pending: null,
  failed: null,
  mode: PANEL_MODE.CONVERSATION,
  selectedHistorySessionId: null,
};

let messageCounter = 0;
const nextMessageId = () => {
  messageCounter += 1;
  return `m${messageCounter}`;
};

export function siaConversationReducer(state, action) {
  switch (action.type) {
    case "SET_INPUT":
      return { ...state, input: action.input };

    case "SUBMIT": {
      // The user turn is rendered immediately and is the ONLY user bubble
      // this logical question will ever produce -- a retry reuses it.
      const userMessage = {
        id: nextMessageId(),
        role: "user",
        content: action.question,
      };
      return {
        ...state,
        messages: [...state.messages, userMessage],
        input: "",
        failed: null,
        pending: {
          clientMessageId: action.clientMessageId,
          question: action.question,
          sessionId: action.sessionId,
          messageId: userMessage.id,
        },
      };
    }

    case "RETRY":
      // Moves the failed request back to pending WITHOUT touching
      // messages: no second user bubble, and the original key/question/
      // session are carried over byte-for-byte.
      if (!state.failed) return state;
      return { ...state, pending: state.failed, failed: null };

    case "SUCCESS": {
      if (!state.pending) return state;
      const assistantMessage = {
        id: nextMessageId(),
        role: "assistant",
        content: action.answer,
      };
      return {
        ...state,
        messages: [...state.messages, assistantMessage],
        // Adopt the server's session id so every later turn continues the
        // same conversation. An absent id (session store unavailable)
        // leaves the previous value untouched.
        activeSessionId: action.sessionId || state.activeSessionId,
        pending: null,
        failed: null,
      };
    }

    case "FAILURE":
      if (!state.pending) return state;
      // No assistant bubble is created -- the failure is attached to the
      // existing user turn, so the transcript never shows a fake answer.
      return {
        ...state,
        pending: null,
        failed: { ...state.pending, code: action.code, message: action.message },
      };

    case "DISMISS_FAILED": {
      if (!state.failed) return state;
      // Abandoning a failed operation also removes its orphaned user turn,
      // so the transcript does not keep a question that was never answered.
      return {
        ...state,
        messages: state.messages.filter((m) => m.id !== state.failed.messageId),
        failed: null,
      };
    }

    case "NEW_CHAT":
      // Clears LOCAL state only. The previous server-side session is left
      // completely intact and remains reachable from history.
      return {
        ...initialState,
        mode: PANEL_MODE.CONVERSATION,
      };

    case "SET_MODE":
      return { ...state, mode: action.mode };

    case "SELECT_HISTORY_SESSION":
      return { ...state, selectedHistorySessionId: action.sessionId };

    case "HYDRATE": {
      // Replaces the transcript ONLY on a successful load, and only for
      // the session the user most recently selected -- a slow response for
      // an abandoned selection is dropped rather than overwriting a newer
      // one.
      if (state.selectedHistorySessionId !== action.sessionId) return state;
      return {
        ...state,
        activeSessionId: action.sessionId,
        messages: action.messages,
        pending: null,
        failed: null,
        mode: PANEL_MODE.CONVERSATION,
        selectedHistorySessionId: null,
      };
    }

    case "CLEAR_ACTIVE_SESSION":
      // Used when the active conversation's server session is deleted.
      if (state.activeSessionId !== action.sessionId) return state;
      return {
        ...initialState,
        mode: state.mode,
      };

    default:
      return state;
  }
}

// Extracts a safe, plain string from a rejected Axios error, never the raw
// error object, config, stack or response body. Mirrors the backend's
// {success:false, message} contract.
export function getErrorMessage(error) {
  const message = error?.response?.data?.message;
  return typeof message === "string" && message.trim() !== "" ? message : GENERIC_ERROR_MESSAGE;
}

export function getErrorCode(error) {
  const code = error?.response?.data?.code;
  return typeof code === "string" ? code : null;
}

// Normalizes server messages for rendering. Unknown roles are dropped
// rather than rendered as an unstyled/mislabelled bubble, and non-string
// content is skipped -- neither can crash the transcript.
export function normalizeServerMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ id: nextMessageId(), role: m.role, content: m.content }));
}

export const MAX_QUESTION_LENGTH = 500;

export function useSiaConversation() {
  const [state, dispatch] = useReducer(siaConversationReducer, initialState);
  const mutation = useSiaAskMutation();
  const queryClient = useQueryClient();

  const isBusy = state.pending !== null;

  const send = useCallback(
    (request) => {
      dispatch({ type: "SUBMIT", ...request });
      mutation.mutate(
        {
          question: request.question,
          sessionId: request.sessionId,
          clientMessageId: request.clientMessageId,
        },
        {
          onSuccess: (data) => {
            dispatch({ type: "SUCCESS", answer: data?.answer ?? "", sessionId: data?.sessionId });
            // The session list's ordering and timestamps just changed.
            queryClient.invalidateQueries({ queryKey: queryKeys.sia.sessions.list() });
          },
          onError: (error) => {
            dispatch({
              type: "FAILURE",
              code: getErrorCode(error),
              message: getErrorMessage(error),
            });
          },
        }
      );
    },
    [mutation, queryClient]
  );

  const submitQuestion = useCallback(() => {
    const question = state.input.trim();
    if (question === "" || question.length > MAX_QUESTION_LENGTH) return;
    if (isBusy || state.failed) return;

    // Exactly one key per distinct logical question.
    send({
      question,
      clientMessageId: createClientMessageId(),
      sessionId: state.activeSessionId,
    });
  }, [state.input, state.activeSessionId, state.failed, isBusy, send]);

  const retry = useCallback(() => {
    if (!state.failed || isBusy) return;
    const { question, clientMessageId, sessionId, messageId } = state.failed;
    dispatch({ type: "RETRY" });
    // Resends the EXACT original key, question and request session -- the
    // backend replays the original answer rather than paying for a second
    // LLM call.
    mutation.mutate(
      { question, sessionId, clientMessageId },
      {
        onSuccess: (data) => {
          dispatch({ type: "SUCCESS", answer: data?.answer ?? "", sessionId: data?.sessionId });
          queryClient.invalidateQueries({ queryKey: queryKeys.sia.sessions.list() });
        },
        onError: (error) => {
          dispatch({ type: "FAILURE", code: getErrorCode(error), message: getErrorMessage(error) });
        },
      }
    );
    return messageId;
  }, [state.failed, isBusy, mutation, queryClient]);

  const setInput = useCallback((input) => dispatch({ type: "SET_INPUT", input }), []);
  const dismissFailed = useCallback(() => dispatch({ type: "DISMISS_FAILED" }), []);
  const newChat = useCallback(() => dispatch({ type: "NEW_CHAT" }), []);
  const setMode = useCallback((mode) => dispatch({ type: "SET_MODE", mode }), []);
  const selectHistorySession = useCallback(
    (sessionId) => dispatch({ type: "SELECT_HISTORY_SESSION", sessionId }),
    []
  );
  const hydrate = useCallback(
    (sessionId, messages) => dispatch({ type: "HYDRATE", sessionId, messages }),
    []
  );
  const clearActiveSession = useCallback(
    (sessionId) => dispatch({ type: "CLEAR_ACTIVE_SESSION", sessionId }),
    []
  );

  return useMemo(
    () => ({
      ...state,
      isBusy,
      canSubmit:
        state.input.trim() !== "" &&
        state.input.trim().length <= MAX_QUESTION_LENGTH &&
        !isBusy &&
        !state.failed,
      setInput,
      submitQuestion,
      retry,
      dismissFailed,
      newChat,
      setMode,
      selectHistorySession,
      hydrate,
      clearActiveSession,
    }),
    [
      state,
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
    ]
  );
}

export default useSiaConversation;
