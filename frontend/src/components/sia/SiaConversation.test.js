import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SiaEntryPoint from "./SiaEntryPoint";
import { askSia } from "../../api/siaApi";
import { getSiaSessions, getSiaSessionMessages, deleteSiaSession } from "../../api/siaSessionsApi";
import { SIA_SUGGESTIONS } from "./siaSuggestions";

// Only the API layer is mocked -- the reducer, hooks, TanStack wiring and
// components under test are all real, so these prove genuine end-to-end
// frontend behaviour rather than a mock agreeing with itself.
jest.mock("../../api/siaApi", () => ({ askSia: jest.fn() }));
jest.mock("../../api/siaSessionsApi", () => ({
  getSiaSessions: jest.fn(),
  getSiaSessionMessages: jest.fn(),
  deleteSiaSession: jest.fn(),
}));

const ENV_KEY = "REACT_APP_SIA_ENABLED";
const originalFlag = process.env[ENV_KEY];

// This jsdom environment exposes no `crypto` global at all, so a Web
// Crypto source is installed for the duration of these tests. Every
// browser the app supports provides this natively over HTTPS -- the shim
// stands in for the environment, not for the code under test (which is
// still the real createClientMessageId).
const originalCrypto = window.crypto;
beforeAll(() => {
  Object.defineProperty(window, "crypto", {
    value: {
      getRandomValues: (bytes) => {
        for (let i = 0; i < bytes.length; i += 1) {
          bytes[i] = Math.floor(Math.random() * 256);
        }
        return bytes;
      },
    },
    configurable: true,
    writable: true,
  });
});

afterAll(() => {
  Object.defineProperty(window, "crypto", {
    value: originalCrypto,
    configurable: true,
    writable: true,
  });
});

beforeEach(() => {
  process.env[ENV_KEY] = "true";
  getSiaSessions.mockResolvedValue({ success: true, sessions: [] });
  getSiaSessionMessages.mockResolvedValue({ success: true, sessionId: "s1", messages: [] });
  deleteSiaSession.mockResolvedValue({ success: true, message: "Session deleted." });
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  if (originalFlag === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = originalFlag;
});

function renderEntryPoint() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 0 } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <SiaEntryPoint />
    </QueryClientProvider>
  );
  return { ...utils, queryClient };
}

const openPanel = () => fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }));
const composer = () => screen.getByLabelText(/your question/i);
const askButton = () => screen.getByRole("button", { name: "Ask" });

async function ask(text) {
  fireEvent.change(composer(), { target: { value: text } });
  await act(async () => {
    fireEvent.click(askButton());
  });
}

const answer = (text, sessionId) => ({
  success: true,
  answer: text,
  intent: "HEALTH_EXPLANATION",
  basedOn: ["financialHealth.overall"],
  ...(sessionId ? { sessionId } : {}),
});

function httpError(status, data) {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, data };
  return err;
}

// ---------------------------------------------------------------------
// Ask and conversation
// ---------------------------------------------------------------------
describe("SIA conversation -- asking", () => {
  it("1. a first question renders one user message and one answer", async () => {
    askSia.mockResolvedValue(answer("Your score is healthy.", "sess-1"));
    renderEntryPoint();
    openPanel();

    await ask("Why is my financial health score low?");

    expect(await screen.findByText("Your score is healthy.")).toBeInTheDocument();
    expect(screen.getByText("Why is my financial health score low?")).toBeInTheDocument();
  });

  it("2. a second question sends the sessionId returned by the first response", async () => {
    askSia
      .mockResolvedValueOnce(answer("First answer.", "sess-abc"))
      .mockResolvedValueOnce(answer("Second answer.", "sess-abc"));
    renderEntryPoint();
    openPanel();

    await ask("Why is my financial health score low?");
    await screen.findByText("First answer.");
    await ask("Why did my overall spending change this month?");
    await screen.findByText("Second answer.");

    expect(askSia.mock.calls[0][0].sessionId).toBeNull();
    expect(askSia.mock.calls[1][0].sessionId).toBe("sess-abc");
  });

  it("3. both question/answer pairs remain rendered", async () => {
    askSia
      .mockResolvedValueOnce(answer("First answer.", "sess-abc"))
      .mockResolvedValueOnce(answer("Second answer.", "sess-abc"));
    renderEntryPoint();
    openPanel();

    await ask("Why is my financial health score low?");
    await screen.findByText("First answer.");
    await ask("Why did my overall spending change this month?");
    await screen.findByText("Second answer.");

    expect(screen.getByText("Why is my financial health score low?")).toBeInTheDocument();
    expect(screen.getByText("First answer.")).toBeInTheDocument();
    expect(screen.getByText("Why did my overall spending change this month?")).toBeInTheDocument();
    expect(screen.getByText("Second answer.")).toBeInTheDocument();
  });

  it("4. every distinct submission receives a distinct clientMessageId", async () => {
    askSia
      .mockResolvedValueOnce(answer("A1", "s"))
      .mockResolvedValueOnce(answer("A2", "s"));
    renderEntryPoint();
    openPanel();

    await ask("Why is my financial health score low?");
    await screen.findByText("A1");
    await ask("Why did my overall spending change this month?");
    await screen.findByText("A2");

    const first = askSia.mock.calls[0][0].clientMessageId;
    const second = askSia.mock.calls[1][0].clientMessageId;
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it("5-7. retry reuses the exact key, question and original sessionId, and adds no duplicate bubble", async () => {
    askSia
      .mockRejectedValueOnce(httpError(503, { success: false, message: "SIA is temporarily unavailable." }))
      .mockResolvedValueOnce(answer("Recovered answer.", "sess-1"));
    renderEntryPoint();
    openPanel();

    await ask("Why is my financial health score low?");
    const retryButton = await screen.findByRole("button", { name: "Retry" });

    await act(async () => {
      fireEvent.click(retryButton);
    });
    await screen.findByText("Recovered answer.");

    const firstCall = askSia.mock.calls[0][0];
    const retryCall = askSia.mock.calls[1][0];
    expect(retryCall.clientMessageId).toBe(firstCall.clientMessageId);
    expect(retryCall.question).toBe(firstCall.question);
    expect(retryCall.sessionId).toBe(firstCall.sessionId);

    // Exactly one user bubble for this logical question.
    expect(screen.getAllByText("Why is my financial health score low?")).toHaveLength(1);
  });

  it("8. a failed first request creates no fake successful turn", async () => {
    askSia.mockRejectedValue(httpError(503, { success: false, message: "SIA is temporarily unavailable." }));
    renderEntryPoint();
    openPanel();

    await ask("Why is my financial health score low?");

    expect(await screen.findByRole("alert")).toHaveTextContent("SIA is temporarily unavailable.");
    expect(screen.getAllByText("Why is my financial health score low?")).toHaveLength(1);
    // No assistant bubble exists at all.
    expect(screen.queryByText(/SIA said:/)).toBeNull();
  });

  it("9. the pending state prevents double submission", async () => {
    let resolveAsk;
    askSia.mockImplementation(() => new Promise((resolve) => {
      resolveAsk = () => resolve(answer("Done.", "s"));
    }));
    renderEntryPoint();
    openPanel();

    fireEvent.change(composer(), { target: { value: "Why is my financial health score low?" } });
    await act(async () => {
      fireEvent.click(askButton());
    });

    expect(askButton()).toBeDisabled();
    fireEvent.click(askButton());
    expect(askSia).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAsk();
    });
  });

  it("10. a truthful no-data 200 renders as a normal answer, not an error", async () => {
    askSia.mockResolvedValue({
      success: true,
      answer: "I do not have enough financial report data yet to explain your financial health score.",
      intent: "HEALTH_EXPLANATION",
      basedOn: ["none"],
    });
    renderEntryPoint();
    openPanel();

    await ask("Why is my financial health score low?");

    expect(
      await screen.findByText(
        "I do not have enough financial report data yet to explain your financial health score."
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("11. closing and reopening the panel retains the conversation", async () => {
    askSia.mockResolvedValue(answer("Persisted answer.", "sess-1"));
    renderEntryPoint();
    openPanel();

    await ask("Why is my financial health score low?");
    await screen.findByText("Persisted answer.");

    fireEvent.click(screen.getByRole("button", { name: "Close SIA" }));
    expect(screen.queryByText("Persisted answer.")).toBeNull();

    openPanel();
    expect(screen.getByText("Persisted answer.")).toBeInTheDocument();
    expect(screen.getByText("Why is my financial health score low?")).toBeInTheDocument();
  });

  it("12. a remount starts fresh without reading any storage", async () => {
    const getItem = jest.spyOn(Storage.prototype, "getItem");
    askSia.mockResolvedValue(answer("First mount answer.", "sess-1"));
    const first = renderEntryPoint();
    openPanel();
    await ask("Why is my financial health score low?");
    await screen.findByText("First mount answer.");

    first.unmount();
    renderEntryPoint();
    openPanel();

    expect(screen.queryByText("First mount answer.")).toBeNull();
    const siaStorageReads = getItem.mock.calls.filter(([key]) => String(key).toLowerCase().includes("sia"));
    expect(siaStorageReads).toHaveLength(0);
    getItem.mockRestore();
  });

  it("13. basedOn and raw internal paths are never rendered", async () => {
    askSia.mockResolvedValue(answer("A grounded answer.", "sess-1"));
    const { container } = renderEntryPoint();
    openPanel();

    await ask("Why is my financial health score low?");
    await screen.findByText("A grounded answer.");

    expect(container.textContent).not.toContain("financialHealth.overall");
    expect(container.textContent).not.toContain("basedOn");
    expect(container.textContent).not.toContain("HEALTH_EXPLANATION");
    expect(container.textContent).not.toContain("sess-1");
  });

  it("14. answers render as safe text rather than HTML", async () => {
    const hostile = "<b>bold</b> spending <img src=x onerror=alert(1)>";
    askSia.mockResolvedValue(answer(hostile, "sess-1"));
    const { container } = renderEntryPoint();
    openPanel();

    await ask("Why is my financial health score low?");

    expect(await screen.findByText(hostile)).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("15. SIA_REQUEST_IN_PROGRESS is retryable with the same key", async () => {
    askSia
      .mockRejectedValueOnce(
        httpError(409, {
          success: false,
          code: "SIA_REQUEST_IN_PROGRESS",
          message: "This request is still being processed. Please retry shortly.",
        })
      )
      .mockResolvedValueOnce(answer("Finally answered.", "sess-1"));
    renderEntryPoint();
    openPanel();

    await ask("Why is my financial health score low?");
    expect(await screen.findByRole("alert")).toHaveTextContent(/still being processed/i);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    await screen.findByText("Finally answered.");

    expect(askSia.mock.calls[1][0].clientMessageId).toBe(askSia.mock.calls[0][0].clientMessageId);
  });

  it("16. SIA_IDEMPOTENCY_CONFLICT offers no same-key retry and never silently regenerates a key", async () => {
    askSia.mockRejectedValue(
      httpError(409, {
        success: false,
        code: "SIA_IDEMPOTENCY_CONFLICT",
        message: "This clientMessageId was already used for a different request.",
      })
    );
    renderEntryPoint();
    openPanel();

    await ask("Why is my financial health score low?");
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be retried safely/i);

    // No Retry control at all for a conflict, and no extra request fired.
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(askSia).toHaveBeenCalledTimes(1);

    // Dismissing lets the user make a deliberate new submission.
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// ---------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------
describe("SIA conversation -- suggestions", () => {
  it("17-18. an empty conversation shows one suggestion per supported intent", () => {
    renderEntryPoint();
    openPanel();

    expect(SIA_SUGGESTIONS).toHaveLength(7);
    const intents = new Set(SIA_SUGGESTIONS.map((s) => s.intent));
    expect(intents.size).toBe(7);

    for (const suggestion of SIA_SUGGESTIONS) {
      expect(screen.getByRole("button", { name: suggestion.text })).toBeInTheDocument();
    }
  });

  it("19-20. selecting a suggestion populates and focuses the composer without submitting", () => {
    renderEntryPoint();
    openPanel();

    const target = SIA_SUGGESTIONS[0];
    fireEvent.click(screen.getByRole("button", { name: target.text }));

    expect(composer()).toHaveValue(target.text);
    expect(composer()).toHaveFocus();
    expect(askSia).not.toHaveBeenCalled();
  });

  it("21. suggestions disappear once a conversation begins and return for New chat", async () => {
    askSia.mockResolvedValue(answer("An answer.", "sess-1"));
    renderEntryPoint();
    openPanel();

    const first = SIA_SUGGESTIONS[0];
    expect(screen.getByRole("button", { name: first.text })).toBeInTheDocument();

    await ask("Why is my financial health score low?");
    await screen.findByText("An answer.");
    expect(screen.queryByRole("button", { name: first.text })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Start a new conversation" }));
    expect(screen.getByRole("button", { name: first.text })).toBeInTheDocument();
    expect(screen.queryByText("An answer.")).toBeNull();
  });
});

// ---------------------------------------------------------------------
// History
// ---------------------------------------------------------------------
describe("SIA conversation -- history", () => {
  const openHistory = () => fireEvent.click(screen.getByRole("button", { name: "Conversation history" }));

  it("22. the history query stays disabled until history is opened", async () => {
    renderEntryPoint();
    openPanel();

    expect(getSiaSessions).not.toHaveBeenCalled();

    await act(async () => {
      openHistory();
    });
    await waitFor(() => expect(getSiaSessions).toHaveBeenCalledTimes(1));
  });

  it("23a. renders the empty state", async () => {
    renderEntryPoint();
    openPanel();
    await act(async () => {
      openHistory();
    });

    expect(await screen.findByText("No past conversations yet.")).toBeInTheDocument();
  });

  it("23b. renders the error state with a retry control", async () => {
    getSiaSessions.mockRejectedValue(httpError(503, { success: false, message: "unavailable" }));
    renderEntryPoint();
    openPanel();
    await act(async () => {
      openHistory();
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/temporarily unavailable/i);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("23c. renders session rows using only backend-provided fields, with a neutral fallback title", async () => {
    getSiaSessions.mockResolvedValue({
      success: true,
      sessions: [
        { sessionId: "s1", title: null, messageCount: 4, lastMessageAt: "2026-08-01T10:00:00.000Z" },
        { sessionId: "s2", title: "Budget talk", messageCount: 2, lastMessageAt: "2026-08-02T10:00:00.000Z" },
      ],
    });
    renderEntryPoint();
    openPanel();
    await act(async () => {
      openHistory();
    });

    expect(await screen.findByText("SIA conversation")).toBeInTheDocument();
    expect(screen.getByText("Budget talk")).toBeInTheDocument();
    expect(screen.getByText(/4 messages/)).toBeInTheDocument();
  });

  it("24-26. selecting a session loads its messages in order and makes it active for the next ask", async () => {
    getSiaSessions.mockResolvedValue({
      success: true,
      sessions: [{ sessionId: "s1", title: "Older chat", messageCount: 2, lastMessageAt: "2026-08-01T10:00:00.000Z" }],
    });
    getSiaSessionMessages.mockResolvedValue({
      success: true,
      sessionId: "s1",
      messages: [
        { role: "user", content: "Earlier question", intent: "HEALTH_EXPLANATION", createdAt: "2026-08-01T09:00:00.000Z" },
        { role: "assistant", content: "Earlier answer", intent: "HEALTH_EXPLANATION", createdAt: "2026-08-01T09:00:01.000Z" },
        { role: "sneaky-unknown-role", content: "should be ignored", createdAt: "2026-08-01T09:00:02.000Z" },
      ],
    });
    askSia.mockResolvedValue(answer("Continued answer.", "s1"));

    renderEntryPoint();
    openPanel();
    await act(async () => {
      openHistory();
    });

    await act(async () => {
      fireEvent.click(await screen.findByText("Older chat"));
    });

    expect(getSiaSessionMessages).toHaveBeenCalledWith("s1", expect.anything());
    expect(await screen.findByText("Earlier question")).toBeInTheDocument();
    expect(screen.getByText("Earlier answer")).toBeInTheDocument();
    // An unknown role is safely ignored rather than crashing or rendering.
    expect(screen.queryByText("should be ignored")).toBeNull();

    // Backend-defined ascending order is preserved.
    const rendered = screen.getAllByText(/^Earlier (question|answer)$/).map((n) => n.textContent);
    expect(rendered).toEqual(["Earlier question", "Earlier answer"]);

    await ask("Why is my financial health score low?");
    await screen.findByText("Continued answer.");
    expect(askSia.mock.calls[0][0].sessionId).toBe("s1");
  });

  it("27. a failed message load does not erase the existing conversation", async () => {
    askSia.mockResolvedValue(answer("Live answer.", "live-session"));
    getSiaSessions.mockResolvedValue({
      success: true,
      sessions: [{ sessionId: "s1", title: "Older chat", messageCount: 2, lastMessageAt: "2026-08-01T10:00:00.000Z" }],
    });
    getSiaSessionMessages.mockRejectedValue(httpError(404, { success: false, message: "Session not found." }));

    renderEntryPoint();
    openPanel();
    await ask("Why is my financial health score low?");
    await screen.findByText("Live answer.");

    await act(async () => {
      openHistory();
    });
    await act(async () => {
      fireEvent.click(await screen.findByText("Older chat"));
    });

    // The user is returned to the list with an understandable message.
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be opened/i);

    // The live transcript survives the failed load untouched.
    fireEvent.click(screen.getByRole("button", { name: "Back to conversation" }));
    await waitFor(() => expect(screen.getByText("Live answer.")).toBeInTheDocument());
  });

  it("28. a superseded selection can never hydrate the wrong session", async () => {
    getSiaSessions.mockResolvedValue({
      success: true,
      sessions: [
        { sessionId: "s1", title: "Chat one", messageCount: 2, lastMessageAt: "2026-08-01T10:00:00.000Z" },
        { sessionId: "s2", title: "Chat two", messageCount: 2, lastMessageAt: "2026-08-02T10:00:00.000Z" },
      ],
    });
    // A stale response arrives claiming to be a session the user is no
    // longer looking at.
    getSiaSessionMessages.mockResolvedValue({
      success: true,
      sessionId: "s1",
      messages: [{ role: "assistant", content: "Stale content from s1", createdAt: "2026-08-01T09:00:00.000Z" }],
    });

    renderEntryPoint();
    openPanel();
    await act(async () => {
      openHistory();
    });
    await act(async () => {
      fireEvent.click(await screen.findByText("Chat two"));
    });

    // The response's own sessionId (s1) disagrees with the selection (s2),
    // so it is discarded rather than hydrated.
    await waitFor(() => expect(screen.queryByText("Stale content from s1")).toBeNull());
  });

  it("29. New chat clears local active state without deleting the server session", async () => {
    askSia.mockResolvedValue(answer("An answer.", "sess-9"));
    renderEntryPoint();
    openPanel();
    await ask("Why is my financial health score low?");
    await screen.findByText("An answer.");

    fireEvent.click(screen.getByRole("button", { name: "Start a new conversation" }));

    expect(screen.queryByText("An answer.")).toBeNull();
    expect(deleteSiaSession).not.toHaveBeenCalled();

    askSia.mockResolvedValue(answer("Brand new answer.", "sess-10"));
    await ask("Why did my overall spending change this month?");
    await screen.findByText("Brand new answer.");
    // The new conversation starts with no session id.
    expect(askSia.mock.calls[1][0].sessionId).toBeNull();
  });
});

// ---------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------
describe("SIA conversation -- deleting a session", () => {
  const openHistory = () => fireEvent.click(screen.getByRole("button", { name: "Conversation history" }));

  async function openHistoryWith(sessions) {
    getSiaSessions.mockResolvedValue({ success: true, sessions });
    renderEntryPoint();
    openPanel();
    await act(async () => {
      openHistory();
    });
    await screen.findByText(sessions[0].title);
  }

  const SESSION = { sessionId: "s1", title: "Deletable chat", messageCount: 2, lastMessageAt: "2026-08-01T10:00:00.000Z" };

  it("30-31. the first delete interaction asks for confirmation; cancel preserves the session", async () => {
    await openHistoryWith([SESSION]);

    fireEvent.click(screen.getByRole("button", { name: "Delete Deletable chat" }));
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeInTheDocument();
    expect(deleteSiaSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Confirm delete" })).toBeNull();
    expect(screen.getByText("Deletable chat")).toBeInTheDocument();
    expect(deleteSiaSession).not.toHaveBeenCalled();
  });

  it("32-33. confirming calls the correct endpoint and refreshes the list", async () => {
    await openHistoryWith([SESSION]);

    fireEvent.click(screen.getByRole("button", { name: "Delete Deletable chat" }));
    getSiaSessions.mockResolvedValue({ success: true, sessions: [] });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    });

    // TanStack v5 invokes mutationFn as (variables, context), so the id is
    // asserted positionally rather than as the sole argument.
    expect(deleteSiaSession).toHaveBeenCalledTimes(1);
    expect(deleteSiaSession.mock.calls[0][0]).toBe("s1");
    await waitFor(() => expect(screen.getByText("No past conversations yet.")).toBeInTheDocument());
  });

  it("34. deleting the ACTIVE session clears the active transcript", async () => {
    askSia.mockResolvedValue(answer("Active answer.", "s1"));
    getSiaSessions.mockResolvedValue({ success: true, sessions: [SESSION] });
    renderEntryPoint();
    openPanel();
    await ask("Why is my financial health score low?");
    await screen.findByText("Active answer.");

    await act(async () => {
      openHistory();
    });
    await screen.findByText("Deletable chat");

    fireEvent.click(screen.getByRole("button", { name: "Delete Deletable chat" }));
    getSiaSessions.mockResolvedValue({ success: true, sessions: [] });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    });

    fireEvent.click(screen.getByRole("button", { name: "Back to conversation" }));
    expect(screen.queryByText("Active answer.")).toBeNull();
  });

  it("35. deleting a NON-active session preserves the current transcript", async () => {
    askSia.mockResolvedValue(answer("Keep me.", "active-session"));
    getSiaSessions.mockResolvedValue({ success: true, sessions: [SESSION] });
    renderEntryPoint();
    openPanel();
    await ask("Why is my financial health score low?");
    await screen.findByText("Keep me.");

    await act(async () => {
      openHistory();
    });
    await screen.findByText("Deletable chat");
    fireEvent.click(screen.getByRole("button", { name: "Delete Deletable chat" }));
    getSiaSessions.mockResolvedValue({ success: true, sessions: [] });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    });

    fireEvent.click(screen.getByRole("button", { name: "Back to conversation" }));
    expect(screen.getByText("Keep me.")).toBeInTheDocument();
  });

  it("36. a failed deletion keeps the session and restores usable controls", async () => {
    await openHistoryWith([SESSION]);
    deleteSiaSession.mockRejectedValue(httpError(503, { success: false, message: "unavailable" }));

    fireEvent.click(screen.getByRole("button", { name: "Delete Deletable chat" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be deleted/i);
    expect(screen.getByText("Deletable chat")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Deletable chat" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------
// Accessibility and keyboard
// ---------------------------------------------------------------------
describe("SIA conversation -- accessibility", () => {
  it("37. every control has an accessible name", async () => {
    askSia.mockRejectedValue(httpError(503, { success: false, message: "SIA is temporarily unavailable." }));
    renderEntryPoint();

    expect(screen.getByRole("button", { name: "Ask SIA" })).toBeInTheDocument();
    openPanel();

    expect(screen.getByRole("button", { name: "Close SIA" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Conversation history" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start a new conversation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask" })).toBeInTheDocument();

    await ask("Why is my financial health score low?");
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("38. Enter submits and Shift+Enter does not", async () => {
    askSia.mockResolvedValue(answer("Keyboard answer.", "s"));
    renderEntryPoint();
    openPanel();

    fireEvent.change(composer(), { target: { value: "Why is my financial health score low?" } });
    fireEvent.keyDown(composer(), { key: "Enter", shiftKey: true });
    expect(askSia).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.keyDown(composer(), { key: "Enter" });
    });
    expect(askSia).toHaveBeenCalledTimes(1);
  });

  it("39. focus returns to the launcher after closing", () => {
    renderEntryPoint();
    openPanel();

    fireEvent.click(screen.getByRole("button", { name: "Close SIA" }));

    expect(screen.getByRole("button", { name: "Ask SIA" })).toHaveFocus();
  });

  it("40. pending and error state changes are announced via live regions", async () => {
    let resolveAsk;
    askSia.mockImplementation(() => new Promise((resolve) => {
      resolveAsk = () => resolve(answer("Announced.", "s"));
    }));
    renderEntryPoint();
    openPanel();

    fireEvent.change(composer(), { target: { value: "Why is my financial health score low?" } });
    await act(async () => {
      fireEvent.click(askButton());
    });

    expect(screen.getByRole("status")).toHaveTextContent(/SIA is thinking/i);

    await act(async () => {
      resolveAsk();
    });
    expect(await screen.findByText("Announced.")).toBeInTheDocument();
  });

  it("the transcript is an accessible log region and roles are labelled for screen readers", async () => {
    askSia.mockResolvedValue(answer("Labelled answer.", "s"));
    renderEntryPoint();
    openPanel();

    expect(screen.getByRole("log", { name: "Conversation" })).toBeInTheDocument();

    await ask("Why is my financial health score low?");
    await screen.findByText("Labelled answer.");

    expect(screen.getByText("You said:")).toBeInTheDocument();
    expect(screen.getByText("SIA said:")).toBeInTheDocument();
  });

  it("blocks submission of blank and overlength input", async () => {
    renderEntryPoint();
    openPanel();

    expect(askButton()).toBeDisabled();

    fireEvent.change(composer(), { target: { value: "   " } });
    expect(askButton()).toBeDisabled();

    fireEvent.change(composer(), { target: { value: "x".repeat(501) } });
    expect(askButton()).toBeDisabled();
    expect(screen.getByText("501 / 500")).toBeInTheDocument();

    expect(askSia).not.toHaveBeenCalled();
  });
});
