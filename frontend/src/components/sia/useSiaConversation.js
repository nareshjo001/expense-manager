import { useCallback, useMemo, useReducer } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSiaAskMutation } from "../../hooks/mutations/useSiaAskMutation";
import { createClientMessageId } from "../../utils/createClientMessageId";
import { queryKeys } from "../../query/queryKeys";

// Owns the entire SIA conversation. Deliberately a reducer rather than a

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
      if (!state.failed) return state;
      return { ...state, pending: state.failed, failed: null };

    case "SUCCESS": {
      if (!state.pending) return state;
      const assistantMessage = {
        id: nextMessageId(),
        role: "assistant",
        kind: "answer",
        content: action.answer,
        // Batch 3F: the server-computed grounding snapshot, passed through
        grounding: action.grounding,
        // Workstream 3: the server's period/metric interpretation summary
        interpretation: action.interpretation,
        planSummary: action.planSummary,
      };
      return {
        ...state,
        messages: [...state.messages, assistantMessage],
        // Adopt the server's session id so every later turn continues the
        activeSessionId: action.sessionId || state.activeSessionId,
        pending: null,
        failed: null,
      };
    }

    // Workstream 3: a `clarification`-kind response from POST /sia/ask
    case "CLARIFICATION": {
      if (!state.pending) return state;
      const assistantMessage = {
        id: nextMessageId(),
        role: "assistant",
        kind: "clarification",
        content: action.prompt,
        options: Array.isArray(action.options) ? action.options : [],
      };
      return {
        ...state,
        messages: [...state.messages, assistantMessage],
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
export function getErrorMessage(error) {
  const message = error?.response?.data?.message;
  return typeof message === "string" && message.trim() !== "" ? message : GENERIC_ERROR_MESSAGE;
}

export function getErrorCode(error) {
  const code = error?.response?.data?.code;
  return typeof code === "string" ? code : null;
}

// Normalizes server messages for rendering. Unknown roles are dropped
export function normalizeServerMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ id: nextMessageId(), role: m.role, content: m.content, grounding: m.grounding }));
}

export const MAX_QUESTION_LENGTH = 500;

// Workstream 3: routes a resolved POST /sia/ask response to the correct
function dispatchAskSuccess(dispatch, data) {
  if (data && data.clarification && typeof data.clarification === "object") {
    dispatch({
      type: "CLARIFICATION",
      prompt: data.clarification.prompt,
      options: data.clarification.options,
      sessionId: data.sessionId,
    });
    return;
  }
  dispatch({
    type: "SUCCESS",
    answer: data?.answer ?? "",
    sessionId: data?.sessionId,
    grounding: data?.grounding,
    interpretation: data?.interpretation,
    planSummary: data?.planSummary,
  });
}

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
            dispatchAskSuccess(dispatch, data);
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

  // Workstream 3: a clarification option click re-submits through this
  const submitClarificationOption = useCallback(
    (option) => {
      if (!option || typeof option.label !== "string" || option.label.trim() === "") return;
      if (isBusy || state.failed) return;

      send({
        question: option.label,
        clientMessageId: createClientMessageId(),
        sessionId: state.activeSessionId,
      });
    },
    [isBusy, state.failed, state.activeSessionId, send]
  );

  const retry = useCallback(() => {
    if (!state.failed || isBusy) return;
    const { question, clientMessageId, sessionId, messageId } = state.failed;
    dispatch({ type: "RETRY" });
    // Resends the EXACT original key, question and request session -- the
    mutation.mutate(
      { question, sessionId, clientMessageId },
      {
        onSuccess: (data) => {
          dispatchAskSuccess(dispatch, data);
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
      submitClarificationOption,
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
      submitClarificationOption,
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
