import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SiaPanel from "./SiaPanel";
import { PANEL_MODE, SIA_ERROR_CODE } from "./useSiaConversation";
import { useSiaSessionMessagesQuery } from "../../hooks/queries/useSiaSessionMessagesQuery";
import { useSiaSessionsQuery } from "../../hooks/queries/useSiaSessionsQuery";
import { transcribeSiaAudio } from "../../api/siaVoiceApi";

jest.mock("../../api/siaApi", () => ({ askSia: jest.fn() }));
jest.mock("../../api/siaSessionsApi", () => ({
  getSiaSessions: jest.fn(),
  getSiaSessionMessages: jest.fn(),
  deleteSiaSession: jest.fn(),
}));
jest.mock("../../hooks/queries/useSiaSessionMessagesQuery", () => ({
  useSiaSessionMessagesQuery: jest.fn(),
}));
jest.mock("../../hooks/queries/useSiaSessionsQuery", () => ({
  useSiaSessionsQuery: jest.fn(),
}));
jest.mock("../../api/siaVoiceApi", () => ({
  transcribeSiaAudio: jest.fn(),
}));

// ---------------------------------------------------------------------
class MockTrack {
  constructor() {
    this.stop = jest.fn();
  }
}
class MockStream {
  getTracks() {
    if (!this._tracks) this._tracks = [new MockTrack(), new MockTrack()];
    return this._tracks;
  }
}
let lastRecorderInstance = null;
class MockMediaRecorder {
  constructor(stream, options) {
    this.stream = stream;
    this.mimeType = (options && options.mimeType) || "audio/webm";
    this.state = "inactive";
    this.ondataavailable = null;
    this.onstop = null;
    this.onerror = null;
    lastRecorderInstance = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob([new Uint8Array([1])], { type: this.mimeType }) });
    }
    queueMicrotask(() => {
      if (this.onstop) this.onstop();
    });
  }
}
MockMediaRecorder.isTypeSupported = jest.fn(() => true);

function installVoiceSupport() {
  window.MediaRecorder = MockMediaRecorder;
  global.MediaRecorder = MockMediaRecorder;
  const getUserMedia = jest.fn(() => Promise.resolve(new MockStream()));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  return { getUserMedia };
}
function uninstallVoiceSupport() {
  delete window.MediaRecorder;
  delete global.MediaRecorder;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
}

const AVAILABLE_VOICE_CAPS = { available: true, maxDurationSeconds: 30, maxBytes: 5_000_000, acceptedMimeTypes: ["audio/webm"] };

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

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  uninstallVoiceSupport();
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
    submitClarificationOption: jest.fn(),
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

function renderPanel(conversation, props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SiaPanel onClose={jest.fn()} conversation={conversation} {...props} />
    </QueryClientProvider>
  );
}

const composer = () => screen.getByLabelText(/your question/i);

// ---------------------------------------------------------------------
describe("SiaPanel -- voice controls visibility", () => {
  it("renders no mic control at all when voiceCapabilities is not supplied (typed chat fully usable)", () => {
    renderPanel(makeConversation());

    expect(screen.queryByRole("button", { name: /voice input/i })).toBeNull();
    expect(composer()).not.toBeDisabled();
  });

  it("renders no mic control when the backend reports voice input unavailable", () => {
    installVoiceSupport();
    renderPanel(makeConversation(), { voiceCapabilities: { ...AVAILABLE_VOICE_CAPS, available: false } });

    expect(screen.queryByRole("button", { name: /voice input/i })).toBeNull();
  });

  it("renders no mic control when the browser itself lacks getUserMedia/MediaRecorder, and the composer stays fully usable", () => {
    uninstallVoiceSupport();
    renderPanel(makeConversation(), { voiceCapabilities: AVAILABLE_VOICE_CAPS });

    expect(screen.queryByRole("button", { name: /voice input/i })).toBeNull();
    expect(composer()).not.toBeDisabled();
    fireEvent.change(composer(), { target: { value: "hello" } });
  });

  it("renders an accessible mic button (role button, aria-pressed=false, labelled 'Start voice input') when both backend and browser support voice", () => {
    installVoiceSupport();
    renderPanel(makeConversation(), { voiceCapabilities: AVAILABLE_VOICE_CAPS });

    const micButton = screen.getByRole("button", { name: "Start voice input" });
    expect(micButton).toHaveAttribute("aria-pressed", "false");
  });

  it("the mic button has the documented 44px minimum hit-target className contract", () => {
    installVoiceSupport();
    renderPanel(makeConversation(), { voiceCapabilities: AVAILABLE_VOICE_CAPS });

    const micButton = screen.getByRole("button", { name: "Start voice input" });
    expect(micButton).toHaveClass("sia-mic-btn");
  });

  it("never requests microphone permission automatically on mount -- only on the button's own click", () => {
    const { getUserMedia } = installVoiceSupport();
    renderPanel(makeConversation(), { voiceCapabilities: AVAILABLE_VOICE_CAPS });

    expect(getUserMedia).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
describe("SiaPanel -- recording lifecycle", () => {
  it("clicking the mic (a direct user gesture) requests permission, then shows Stop/Cancel and a timer while recording", async () => {
    installVoiceSupport();
    renderPanel(makeConversation(), { voiceCapabilities: AVAILABLE_VOICE_CAPS });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
    });

    expect(await screen.findByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stop recording \(0:00\)/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("Cancel during recording discards the attempt -- never calls the transcription API, mic returns to Start voice input", async () => {
    installVoiceSupport();
    renderPanel(makeConversation(), { voiceCapabilities: AVAILABLE_VOICE_CAPS });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
    });
    await screen.findByRole("button", { name: "Cancel" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await Promise.resolve();
    });

    expect(transcribeSiaAudio).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Start voice input" })).toBeInTheDocument());
  });

  it("a successful transcription inserts the transcript into an EMPTY composer exactly once, and never auto-submits", async () => {
    installVoiceSupport();
    transcribeSiaAudio.mockResolvedValue({ success: true, transcript: "why did my spending change" });
    const conversation = makeConversation();
    renderPanel(conversation, { voiceCapabilities: AVAILABLE_VOICE_CAPS });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
    });
    await screen.findByRole("button", { name: "Stop" });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(conversation.setInput).toHaveBeenCalledWith("why did my spending change"));
    expect(conversation.setInput).toHaveBeenCalledTimes(1);
    expect(conversation.submitQuestion).not.toHaveBeenCalled();
  });

  it("draft preservation: existing composer text is preserved, with the transcript appended via a single space separator", async () => {
    installVoiceSupport();
    transcribeSiaAudio.mockResolvedValue({ success: true, transcript: "this month" });
    const conversation = makeConversation({ input: "How much did I spend" });
    renderPanel(conversation, { voiceCapabilities: AVAILABLE_VOICE_CAPS });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
    });
    await screen.findByRole("button", { name: "Stop" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(conversation.setInput).toHaveBeenCalledWith("How much did I spend this month")
    );
  });

  it("500-char boundary: an insert that would exceed the limit is rejected, the draft is left untouched, and an inline error is shown", async () => {
    installVoiceSupport();
    const longTranscript = "y".repeat(30);
    transcribeSiaAudio.mockResolvedValue({ success: true, transcript: longTranscript });
    const conversation = makeConversation({ input: "x".repeat(480) });
    renderPanel(conversation, { voiceCapabilities: AVAILABLE_VOICE_CAPS });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
    });
    await screen.findByRole("button", { name: "Stop" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/too long to add/i);
    expect(conversation.setInput).not.toHaveBeenCalled();
  });

  it("recording never generates or reuses a clientMessageId and never calls the ask mutation itself", async () => {
    installVoiceSupport();
    transcribeSiaAudio.mockResolvedValue({ success: true, transcript: "hello" });
    const conversation = makeConversation();
    renderPanel(conversation, { voiceCapabilities: AVAILABLE_VOICE_CAPS });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
    });
    await screen.findByRole("button", { name: "Stop" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(conversation.setInput).toHaveBeenCalled());
    expect(conversation.submitQuestion).not.toHaveBeenCalled();
    expect(conversation.submitClarificationOption).not.toHaveBeenCalled();
  });

  it("a permission-denied error is announced via the live region and via a visible message, never color alone", async () => {
    global.MediaRecorder = MockMediaRecorder;
    window.MediaRecorder = MockMediaRecorder;
    const getUserMedia = jest.fn(() =>
      Promise.reject(Object.assign(new Error("denied"), { name: "NotAllowedError" }))
    );
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    renderPanel(makeConversation(), { voiceCapabilities: AVAILABLE_VOICE_CAPS });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/permission was denied/i);
  });
});

// ---------------------------------------------------------------------
describe("SiaPanel -- Escape precedence", () => {
  it("Escape while recording cancels the recording and leaves the panel open (onClose not called)", async () => {
    installVoiceSupport();
    const onClose = jest.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <SiaPanel onClose={onClose} conversation={makeConversation()} voiceCapabilities={AVAILABLE_VOICE_CAPS} />
      </QueryClientProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
    });
    await screen.findByRole("button", { name: "Stop" });

    fireEvent.keyDown(screen.getByRole("button", { name: "Stop" }), { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Start voice input" })).toBeInTheDocument());
  });

  it("Escape with no recording active closes the panel", () => {
    const onClose = jest.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <SiaPanel onClose={onClose} conversation={makeConversation()} />
      </QueryClientProvider>
    );

    fireEvent.keyDown(composer(), { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------
describe("SiaPanel -- clarification rendering", () => {
  const clarificationMessage = {
    id: "m2",
    role: "assistant",
    kind: "clarification",
    content: "Which category did you mean?",
    options: [
      { id: "food", label: "Food" },
      { id: "transport", label: "Transport" },
    ],
  };

  it("renders each clarification option as an accessible button, and clicking one calls submitClarificationOption with that exact option", () => {
    const conversation = makeConversation({
      messages: [{ id: "m1", role: "user", content: "How much on that?" }, clarificationMessage],
    });
    renderPanel(conversation);

    expect(screen.getByText("Which category did you mean?")).toBeInTheDocument();
    const foodButton = screen.getByRole("button", { name: "Food" });
    const transportButton = screen.getByRole("button", { name: "Transport" });
    expect(foodButton.tagName).toBe("BUTTON");
    expect(transportButton.tagName).toBe("BUTTON");

    fireEvent.click(foodButton);

    expect(conversation.submitClarificationOption).toHaveBeenCalledTimes(1);
    expect(conversation.submitClarificationOption).toHaveBeenCalledWith({ id: "food", label: "Food" });
  });

  it("focuses the first clarification option once it is rendered", async () => {
    const conversation = makeConversation({
      messages: [{ id: "m1", role: "user", content: "How much on that?" }, clarificationMessage],
    });
    renderPanel(conversation);

    await waitFor(() => expect(screen.getByRole("button", { name: "Food" })).toHaveFocus());
  });

  it("clarification option buttons are disabled while a request is already busy", () => {
    const conversation = makeConversation({
      messages: [clarificationMessage],
      isBusy: true,
      pending: { clientMessageId: "k", question: "q", sessionId: null, messageId: "m3" },
    });
    renderPanel(conversation);

    expect(screen.getByRole("button", { name: "Food" })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------
describe("SiaPanel -- interpretation trust label", () => {
  it("renders a human-readable 'Using {periodLabel}' label near the answer", () => {
    const conversation = makeConversation({
      messages: [
        { id: "m1", role: "user", content: "How much did I spend this month?" },
        {
          id: "m2",
          role: "assistant",
          kind: "answer",
          content: "You spent 4500 this month.",
          interpretation: { periodLabel: "this month", metrics: ["EXPENSE_TOTAL"] },
        },
      ],
    });
    renderPanel(conversation);

    expect(screen.getByText("Using this month")).toBeInTheDocument();
    // The internal metric id is never rendered anywhere in the panel.
    expect(screen.queryByText(/EXPENSE_TOTAL/)).not.toBeInTheDocument();
  });

  it("renders no interpretation label when the message carries none", () => {
    const conversation = makeConversation({
      messages: [{ id: "m2", role: "assistant", kind: "answer", content: "Fine." }],
    });
    const { container } = renderPanel(conversation);

    expect(container.querySelector(".sia-interpretation")).toBeNull();
  });

  it("renders a compact multi-period label for a grounded v2 answer without exposing plan metrics", () => {
    const conversation = makeConversation({
      messages: [
        {
          id: "m2",
          role: "assistant",
          kind: "answer",
          content: "Your spending increased compared with the previous month.",
          interpretation: { periodLabels: ["this month", "last month"], metrics: ["EXPENSE_TOTAL"] },
        },
      ],
    });
    renderPanel(conversation);

    expect(screen.getByText("Using this month, last month")).toBeInTheDocument();
    expect(screen.queryByText(/EXPENSE_TOTAL/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------
describe("SiaPanel -- Listen/Stop speech synthesis", () => {
  const originalSpeechSynthesis = window.speechSynthesis;
  const originalUtterance = window.SpeechSynthesisUtterance;

  afterEach(() => {
    // Unmounts (running SiaSpeakButton's own cleanup effects, which call
    cleanup();
    window.speechSynthesis = originalSpeechSynthesis;
    window.SpeechSynthesisUtterance = originalUtterance;
  });

  function installSpeechSynthesis() {
    const speak = jest.fn();
    const cancel = jest.fn();
    window.speechSynthesis = { speak, cancel };
    window.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) {
      this.text = text;
    };
    return { speak, cancel };
  }

  it("renders no Listen control when speechSynthesis is unsupported, and answer text still renders normally", () => {
    delete window.speechSynthesis;
    delete window.SpeechSynthesisUtterance;
    const conversation = makeConversation({
      messages: [{ id: "m2", role: "assistant", kind: "answer", content: "Your answer text." }],
    });
    renderPanel(conversation);

    expect(screen.queryByRole("button", { name: /listen to answer/i })).toBeNull();
    expect(screen.getByText("Your answer text.")).toBeInTheDocument();
  });

  it("renders an accessible Listen button, and clicking it speaks ONLY the answer text", () => {
    const { speak } = installSpeechSynthesis();
    const conversation = makeConversation({
      messages: [
        {
          id: "m2",
          role: "assistant",
          kind: "answer",
          content: "Your answer text.",
          grounding: { sources: [{ key: "a", label: "A" }] },
          interpretation: { periodLabel: "this month" },
        },
      ],
    });
    renderPanel(conversation);

    fireEvent.click(screen.getByRole("button", { name: "Listen to answer" }));

    expect(speak).toHaveBeenCalledTimes(1);
    const utterance = speak.mock.calls[0][0];
    expect(utterance.text).toBe("Your answer text.");
    expect(utterance.text).not.toMatch(/this month/);
  });

  it("converts Markdown tables into labelled speech without table separators", () => {
    const { speak } = installSpeechSynthesis();
    const conversation = makeConversation({
      messages: [
        {
          id: "m2",
          role: "assistant",
          kind: "answer",
          content: "| Metric | Amount |\n| --- | ---: |\n| Income | ₹10,000 |\n| Expenses | ₹3,914 |",
        },
      ],
    });
    renderPanel(conversation);

    fireEvent.click(screen.getByRole("button", { name: "Listen to answer" }));

    expect(speak.mock.calls[0][0].text).toBe("Metric: Income, Amount: ₹10,000\nMetric: Expenses, Amount: ₹3,914");
  });

  it("clicking Listen then Stop cancels speech", () => {
    const { cancel } = installSpeechSynthesis();
    const conversation = makeConversation({
      messages: [{ id: "m2", role: "assistant", kind: "answer", content: "Answer." }],
    });
    renderPanel(conversation);

    fireEvent.click(screen.getByRole("button", { name: "Listen to answer" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop reading" }));

    expect(cancel).toHaveBeenCalled();
  });

  it("never renders a Listen control for a clarification message", () => {
    installSpeechSynthesis();
    const conversation = makeConversation({
      messages: [
        { id: "m2", role: "assistant", kind: "clarification", content: "Which one?", options: [{ id: "a", label: "A" }] },
      ],
    });
    renderPanel(conversation);

    expect(screen.queryByRole("button", { name: /listen to answer/i })).toBeNull();
  });
});

// ---------------------------------------------------------------------
describe("SiaPanel -- Workstream 3 regression guard", () => {
  it("typed submission still works exactly as before with no voiceCapabilities supplied", () => {
    const conversation = makeConversation({ input: "Why did my spending change?", canSubmit: true });
    renderPanel(conversation);

    fireEvent.click(screen.getByRole("button", { name: "Ask" }));

    expect(conversation.submitQuestion).toHaveBeenCalledTimes(1);
  });

  it("New chat cancels any active recording before clearing the conversation", async () => {
    installVoiceSupport();
    const conversation = makeConversation();
    renderPanel(conversation, { voiceCapabilities: AVAILABLE_VOICE_CAPS });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Start voice input" }));
    });
    await screen.findByRole("button", { name: "Stop" });

    fireEvent.click(screen.getByRole("button", { name: "Start a new conversation" }));

    expect(conversation.newChat).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "Start voice input" })).toBeInTheDocument());
  });
});
