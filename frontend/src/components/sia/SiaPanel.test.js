import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SiaPanel from "./SiaPanel";
import { PANEL_MODE, SIA_ERROR_CODE } from "./useSiaConversation";
import { useSiaSessionMessagesQuery } from "../../hooks/queries/useSiaSessionMessagesQuery";
import { useSiaSessionsQuery } from "../../hooks/queries/useSiaSessionsQuery";

// Batch 3C: SiaPanel is now pure presentation -- the conversation state it
jest.mock("../../api/siaApi", () => ({ askSia: jest.fn() }));
jest.mock("../../api/siaSessionsApi", () => ({
  getSiaSessions: jest.fn(),
  getSiaSessionMessages: jest.fn(),
  deleteSiaSession: jest.fn(),
}));
// Workstream 3: SiaPanel now transitively renders SiaVoiceRecorderControls
jest.mock("../../api/siaVoiceApi", () => ({ transcribeSiaAudio: jest.fn() }));

jest.mock("../../hooks/queries/useSiaSessionMessagesQuery", () => ({
  useSiaSessionMessagesQuery: jest.fn(),
}));

jest.mock("../../hooks/queries/useSiaSessionsQuery", () => ({
  useSiaSessionsQuery: jest.fn(),
}));

// This project's CRA Jest config enables `resetMocks`, which clears any
beforeEach(() => {
  useSiaSessionMessagesQuery.mockReturnValue({ isSuccess: false, isError: false, data: undefined });
  useSiaSessionsQuery.mockReturnValue({
    data: { success: true, sessions: [] },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: jest.fn(),
  });
});

function makeConversation(overrides = {}) {
  return {
    activeSessionId: null,
    messages: [],
    input: "",
    pending: null,
    failed: null,
    mode: PANEL_MODE.CONVERSATION,
    selectedHistorySessionId: null,
    isBusy: false,
    canSubmit: false,
    setInput: jest.fn(),
    submitQuestion: jest.fn(),
    retry: jest.fn(),
    dismissFailed: jest.fn(),
    newChat: jest.fn(),
    setMode: jest.fn(),
    selectHistorySession: jest.fn(),
    hydrate: jest.fn(),
    clearActiveSession: jest.fn(),
    ...overrides,
  };
}

function renderPanel(conversation, onClose = jest.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SiaPanel onClose={onClose} conversation={conversation} />
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

const userTurn = { id: "m1", role: "user", content: "Why did my spending change?" };

describe("frontend/src/components/sia/SiaPanel", () => {
  it("renders the accessible heading, question field, Ask button, and Close SIA control", () => {
    renderPanel(makeConversation());

    expect(screen.getByRole("heading", { name: "Ask SIA" })).toBeInTheDocument();
    expect(screen.getByLabelText(/your question/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close SIA" })).toBeInTheDocument();
  });

  it("opens without focusing the composer on mobile, so the virtual keyboard stays closed", () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });

    try {
      renderPanel(makeConversation());

      expect(screen.getByRole("button", { name: "Close SIA" })).toHaveFocus();
      expect(screen.getByLabelText(/your question/i)).not.toHaveFocus();
      expect(document.body).toHaveClass("sia-mobile-panel-open");
    } finally {
      cleanup();
      expect(document.body).not.toHaveClass("sia-mobile-panel-open");
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
    }
  });

  it("keeps composer autofocus on desktop", () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });

    try {
      renderPanel(makeConversation());

      expect(screen.getByLabelText(/your question/i)).toHaveFocus();
    } finally {
      cleanup();
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
    }
  });

  it("does not submit when the conversation reports the input is not submittable", () => {
    const conversation = makeConversation({ input: "   ", canSubmit: false });
    renderPanel(conversation);

    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
    expect(conversation.submitQuestion).not.toHaveBeenCalled();
  });

  it("submits through the conversation when the input is valid", () => {
    const conversation = makeConversation({ input: "Why did my spending change?", canSubmit: true });
    renderPanel(conversation);

    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(conversation.submitQuestion).toHaveBeenCalledTimes(1);
  });

  it("shows an accessible pending state and disables Ask while a request is active", () => {
    const conversation = makeConversation({
      messages: [userTurn],
      pending: { clientMessageId: "k", question: "Q", sessionId: null, messageId: "m1" },
      isBusy: true,
      canSubmit: false,
    });
    renderPanel(conversation);

    expect(screen.getByRole("status")).toHaveTextContent(/SIA is thinking/i);
    expect(screen.getByRole("button", { name: "Ask" })).toBeDisabled();
  });

  it("renders a successful answer exactly", () => {
    const conversation = makeConversation({
      messages: [userTurn, { id: "m2", role: "assistant", content: "Your spending increased mainly in food." }],
    });
    renderPanel(conversation);

    expect(screen.getByText("Your spending increased mainly in food.")).toBeInTheDocument();
  });

  it('renders a no-data answer (basedOn: ["none"]) as a normal success', () => {
    const conversation = makeConversation({
      messages: [
        userTurn,
        {
          id: "m2",
          role: "assistant",
          content: "I do not have enough financial report data yet to explain your financial health score.",
        },
      ],
    });
    renderPanel(conversation);

    expect(
      screen.getByText(
        "I do not have enough financial report data yet to explain your financial health score."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a backend-provided error message in an accessible alert attached to its own turn", () => {
    const conversation = makeConversation({
      messages: [userTurn],
      failed: {
        messageId: "m1",
        clientMessageId: "k",
        question: "Q",
        sessionId: null,
        code: null,
        message: "SIA is temporarily unavailable.",
      },
    });
    renderPanel(conversation);

    expect(screen.getByRole("alert")).toHaveTextContent("SIA is temporarily unavailable.");
  });

  it("Retry delegates to the conversation, which reuses the original key", () => {
    const conversation = makeConversation({
      messages: [userTurn],
      failed: {
        messageId: "m1",
        clientMessageId: "k",
        question: "Q",
        sessionId: null,
        code: null,
        message: "SIA is temporarily unavailable.",
      },
    });
    renderPanel(conversation);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(conversation.retry).toHaveBeenCalledTimes(1);
  });

  it("offers no Retry for an idempotency conflict, since the same key can never succeed", () => {
    const conversation = makeConversation({
      messages: [userTurn],
      failed: {
        messageId: "m1",
        clientMessageId: "k",
        question: "Q",
        sessionId: null,
        code: SIA_ERROR_CODE.CONFLICT,
        message: "This clientMessageId was already used for a different request.",
      },
    });
    renderPanel(conversation);

    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be retried safely/i);
  });

  it("invokes onClose exactly once when the close button is clicked", () => {
    const onClose = jest.fn();
    renderPanel(makeConversation(), onClose);

    fireEvent.click(screen.getByRole("button", { name: "Close SIA" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not throw when onClose is omitted and the close button is clicked", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <SiaPanel conversation={makeConversation()} />
      </QueryClientProvider>
    );

    expect(() => fireEvent.click(screen.getByRole("button", { name: "Close SIA" }))).not.toThrow();
  });

  it("renders HTML-like answer content as literal text, never as markup", () => {
    const htmlLikeAnswer = "<b>bold</b> spending increase <img src=x onerror=alert(1)>";
    const conversation = makeConversation({
      messages: [userTurn, { id: "m2", role: "assistant", content: htmlLikeAnswer }],
    });
    const { container } = renderPanel(conversation);

    expect(screen.getByText(htmlLikeAnswer)).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("switches to the history view through the conversation's mode setter", () => {
    const conversation = makeConversation();
    renderPanel(conversation);

    fireEvent.click(screen.getByRole("button", { name: "Conversation history" }));

    expect(conversation.setMode).toHaveBeenCalledWith(PANEL_MODE.HISTORY);
  });

  it("renders the history view instead of the transcript when in history mode", () => {
    renderPanel(makeConversation({ mode: PANEL_MODE.HISTORY }));

    expect(screen.getByRole("region", { name: "Conversation history" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/your question/i)).toBeNull();
  });
});

// FE-001-T08 -- a genuine status-query failure previously collapsed into the
// exact same "SIA is temporarily unavailable" copy as a clean
// available:false response.
describe("frontend/src/components/sia/SiaPanel -- FE-001-T08 availability notice copy", () => {
  function renderWithAvailability(overrides) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <SiaPanel
          onClose={jest.fn()}
          conversation={makeConversation()}
          isCheckingAvailability={false}
          isAvailable={false}
          {...overrides}
        />
      </QueryClientProvider>
    );
  }

  it("shows the generic unavailable copy for a clean available:false response (isAvailabilityError not set)", () => {
    renderWithAvailability({});

    expect(screen.getByRole("status")).toHaveTextContent(/sia is temporarily unavailable/i);
  });

  it("shows distinct copy when the status query itself failed", () => {
    renderWithAvailability({ isAvailabilityError: true });

    expect(screen.getByRole("status")).toHaveTextContent(/couldn't check sia's availability/i);
    expect(screen.queryByText(/sia is temporarily unavailable/i)).not.toBeInTheDocument();
  });

  it("still fail-closes (composer disabled) regardless of which unavailable copy is shown", () => {
    renderWithAvailability({ isAvailabilityError: true });

    expect(screen.getByLabelText(/your question/i)).toBeDisabled();
  });
});

// FE-001-T08 -- selecting a history session sets selectedHistorySessionId
// but `mode` stays HISTORY until messagesQuery actually succeeds, so
// previously there was no indication a specific session was being opened.
describe("frontend/src/components/sia/SiaPanel -- FE-001-T08 history-open loading state", () => {
  it("shows an accessible 'Opening conversation' status while messagesQuery loads for the selected session", () => {
    useSiaSessionMessagesQuery.mockReturnValue({ isSuccess: false, isError: false, isLoading: true, data: undefined });

    renderPanel(makeConversation({ mode: PANEL_MODE.HISTORY, selectedHistorySessionId: "s1" }));

    const opening = screen.getByText(/opening conversation/i);
    expect(opening).toBeInTheDocument();
    expect(opening).toHaveAttribute("role", "status");
  });

  it("does not show the opening status once messagesQuery has settled", () => {
    useSiaSessionMessagesQuery.mockReturnValue({ isSuccess: true, isError: false, isLoading: false, data: { sessionId: "s1", messages: [] } });

    renderPanel(makeConversation({ mode: PANEL_MODE.HISTORY, selectedHistorySessionId: "s1" }));

    expect(screen.queryByText(/opening conversation/i)).not.toBeInTheDocument();
  });

  it("does not show the opening status when no session is selected yet", () => {
    useSiaSessionMessagesQuery.mockReturnValue({ isSuccess: false, isError: false, isLoading: false, data: undefined });

    renderPanel(makeConversation({ mode: PANEL_MODE.HISTORY, selectedHistorySessionId: null }));

    expect(screen.queryByText(/opening conversation/i)).not.toBeInTheDocument();
  });
});
