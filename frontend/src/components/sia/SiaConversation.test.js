import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider, notifyManager } from "@tanstack/react-query";
import SiaEntryPoint from "./SiaEntryPoint";
import { askSia } from "../../api/siaApi";
import { getSiaSessions, getSiaSessionMessages, deleteSiaSession, getSiaStatus } from "../../api/siaSessionsApi";
import { SIA_SUGGESTIONS } from "./siaSuggestions";

// Only the API layer is mocked -- the reducer, hooks, TanStack wiring and
// components under test are all real, so these prove genuine end-to-end
// frontend behaviour rather than a mock agreeing with itself.
jest.mock("../../api/siaApi", () => ({ askSia: jest.fn() }));
jest.mock("../../api/siaSessionsApi", () => ({
  getSiaSessions: jest.fn(),
  getSiaSessionMessages: jest.fn(),
  deleteSiaSession: jest.fn(),
  // Batch 3E: SiaEntryPoint now checks runtime availability before the
  // composer is usable. Every test in this file is about the CONVERSATION
  // behaviour of a healthy deployment, so the status call is stubbed as
  // available below -- the unavailable/degraded paths have their own
  // dedicated suite (SiaAvailability.test.js). No assertion here was
  // relaxed to accommodate the new query.
  getSiaStatus: jest.fn(),
}));
// Workstream 3: SiaEntryPoint -> SiaPanel now transitively renders
// SiaVoiceRecorderControls -> useSiaVoiceRecorder -> siaVoiceApi.js, which
// imports the shared axios instance -- mocked for the same ESM-import
// reason as the two mocks above. No test in this file exercises voice
// recording (see SiaPanel.workstream3.test.js/useSiaVoiceRecorder.test.js).
jest.mock("../../api/siaVoiceApi", () => ({ transcribeSiaAudio: jest.fn() }));

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

// Batch 3F acceptance remediation -- requirement 5.
//
// Root cause of the intermittent "not configured to support act(...)"
// warnings: TanStack Query's notifyManager defers every query-state
// notification through a `setTimeout(fn, 0)` scheduler
// (query-core/src/notifyManager.ts's `defaultScheduler`), not a
// synchronous call. A notification scheduled during one test's
// synchronous/awaited body can therefore fire AFTER that test's body (and
// even after RTL's cleanup() has unmounted) has already returned control
// to Jest, landing inside whichever later test's console-capture window
// happens to be active at that moment -- which is exactly why the warning
// was intermittent and order-dependent rather than tied to any one test.
//
// notifyManager.setNotifyFunction() is TanStack Query's own documented
// hook for this (see its source comment: "This can be used to for example
// wrap notifications with React.act while running tests"). Wrapping every
// notification in `act()` here means ANY update that fires -- synchronously
// or via the deferred setTimeout, during this test's body or spilling into
// a later one -- is always reported to React inside an act() boundary, so
// React never has cause to warn, regardless of timing. This is a global,
// file-level fix (not per-test) because the deferred notification that
// warns is frequently attributable to the PREVIOUS test, not the currently
// running one -- a per-test wrap cannot reach a callback that fires after
// that test's own act() block has already closed.
beforeAll(() => {
  notifyManager.setNotifyFunction((callback) => {
    act(() => {
      callback();
    });
  });
  notifyManager.setBatchNotifyFunction((callback) => {
    act(() => {
      callback();
    });
  });
});
afterAll(() => {
  // Restored to TanStack Query's own default (a synchronous passthrough --
  // see query-core/src/notifyManager.ts's createNotifyManager()) so no
  // other suite's console-warning behaviour is affected by module load
  // order or by this file running before/after another Jest file in the
  // same worker.
  notifyManager.setNotifyFunction((callback) => callback());
  notifyManager.setBatchNotifyFunction((callback) => callback());
});

// Every QueryClient created by renderEntryPoint() below is tracked here so
// afterEach can clear it -- cleanup() (RTL) unmounts the DOM tree, but it
// does not clear a QueryClient's own internal query cache/observers/timers,
// which is a second, independent source of a state update landing after a
// test has already finished.
const activeQueryClients = [];

beforeEach(() => {
  process.env[ENV_KEY] = "true";
  getSiaStatus.mockResolvedValue({ success: true, available: true });
  getSiaSessions.mockResolvedValue({ success: true, sessions: [] });
  getSiaSessionMessages.mockResolvedValue({ success: true, sessionId: "s1", messages: [] });
  deleteSiaSession.mockResolvedValue({ success: true, message: "Session deleted." });
});

afterEach(async () => {
  cleanup();
  // Cancel any in-flight queries and clear each QueryClient's cache/
  // observers before the next test starts, wrapped in act() so any
  // resulting synchronous notification is itself act()-reported. This
  // closes the second, independent source of a late state update: a
  // QueryClient created by an earlier test but never explicitly told to
  // stop, even after its DOM tree is already unmounted.
  for (const queryClient of activeQueryClients) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await queryClient.cancelQueries();
      queryClient.clear();
    });
  }
  activeQueryClients.length = 0;
  jest.clearAllMocks();
  if (originalFlag === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = originalFlag;
});

function renderEntryPoint() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 0 } },
  });
  activeQueryClients.push(queryClient);
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <SiaEntryPoint />
    </QueryClientProvider>
  );
  return { ...utils, queryClient };
}

// Batch 3E: opening the panel now also waits for the runtime availability
// check to settle. Every test in this file describes a HEALTHY deployment
// (getSiaStatus is stubbed available in beforeEach), so waiting here simply
// skips the brief, correct "Checking SIA availability..." state rather than
// weakening anything -- the checking/unavailable states have their own
// dedicated suite in SiaAvailability.test.js.
const openPanel = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }));
  await waitFor(() => expect(composer()).not.toBeDisabled());
};
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
    await openPanel();

    await ask("Why is my financial health score low?");

    expect(await screen.findByText("Your score is healthy.")).toBeInTheDocument();
    expect(screen.getByText("Why is my financial health score low?")).toBeInTheDocument();
  });

  it("2. a second question sends the sessionId returned by the first response", async () => {
    askSia
      .mockResolvedValueOnce(answer("First answer.", "sess-abc"))
      .mockResolvedValueOnce(answer("Second answer.", "sess-abc"));
    renderEntryPoint();
    await openPanel();

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
    await openPanel();

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
    await openPanel();

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
    await openPanel();

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
    await openPanel();

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
    await openPanel();

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
    await openPanel();

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
    await openPanel();

    await ask("Why is my financial health score low?");
    await screen.findByText("Persisted answer.");

    fireEvent.click(screen.getByRole("button", { name: "Close SIA" }));
    expect(screen.queryByText("Persisted answer.")).toBeNull();

    await openPanel();
    expect(screen.getByText("Persisted answer.")).toBeInTheDocument();
    expect(screen.getByText("Why is my financial health score low?")).toBeInTheDocument();
  });

  it("12. a remount starts fresh without reading any storage", async () => {
    const getItem = jest.spyOn(Storage.prototype, "getItem");
    askSia.mockResolvedValue(answer("First mount answer.", "sess-1"));
    const first = renderEntryPoint();
    await openPanel();
    await ask("Why is my financial health score low?");
    await screen.findByText("First mount answer.");

    first.unmount();
    renderEntryPoint();
    await openPanel();

    expect(screen.queryByText("First mount answer.")).toBeNull();
    const siaStorageReads = getItem.mock.calls.filter(([key]) => String(key).toLowerCase().includes("sia"));
    expect(siaStorageReads).toHaveLength(0);
    getItem.mockRestore();
  });

  it("13. basedOn and raw internal paths are never rendered", async () => {
    askSia.mockResolvedValue(answer("A grounded answer.", "sess-1"));
    const { container } = renderEntryPoint();
    await openPanel();

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
    await openPanel();

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
    await openPanel();

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
    await openPanel();

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
  it("17-18. an empty conversation shows one suggestion per supported intent", async () => {
    renderEntryPoint();
    await openPanel();

    expect(SIA_SUGGESTIONS).toHaveLength(7);
    const intents = new Set(SIA_SUGGESTIONS.map((s) => s.intent));
    expect(intents.size).toBe(7);

    for (const suggestion of SIA_SUGGESTIONS) {
      expect(screen.getByRole("button", { name: suggestion.text })).toBeInTheDocument();
    }
  });

  it("19-20. selecting a suggestion populates and focuses the composer without submitting", async () => {
    renderEntryPoint();
    await openPanel();

    const target = SIA_SUGGESTIONS[0];
    fireEvent.click(screen.getByRole("button", { name: target.text }));

    expect(composer()).toHaveValue(target.text);
    expect(composer()).toHaveFocus();
    expect(askSia).not.toHaveBeenCalled();
  });

  it("21. suggestions disappear once a conversation begins and return for New chat", async () => {
    askSia.mockResolvedValue(answer("An answer.", "sess-1"));
    renderEntryPoint();
    await openPanel();

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
    await openPanel();

    expect(getSiaSessions).not.toHaveBeenCalled();

    await act(async () => {
      openHistory();
    });
    await waitFor(() => expect(getSiaSessions).toHaveBeenCalledTimes(1));
  });

  it("23a. renders the empty state", async () => {
    renderEntryPoint();
    await openPanel();
    await act(async () => {
      openHistory();
    });

    expect(await screen.findByText("No past conversations yet.")).toBeInTheDocument();
  });

  it("23b. renders the error state with a retry control", async () => {
    getSiaSessions.mockRejectedValue(httpError(503, { success: false, message: "unavailable" }));
    renderEntryPoint();
    await openPanel();
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
    await openPanel();
    await act(async () => {
      openHistory();
    });

    expect(await screen.findByText("SIA conversation")).toBeInTheDocument();
    expect(screen.getByText("Budget talk")).toBeInTheDocument();
    expect(screen.getByText(/4 messages/)).toBeInTheDocument();
  });

  // Batch 3G remediation: closes the audit's frontend title-synchronization
  // coverage gap. Every other `title`-related test in this file (23c above,
  // and the ones near "24-26"/grounding/etc.) seeds a mocked getSiaSessions
  // response with a title already present -- none of them proves that a
  // BRAND-NEW session's backend-derived title actually becomes visible
  // through this app's real invalidate/refetch cycle after a live ask. This
  // test proves exactly that sequence end-to-end, using the SAME
  // queryKeys.sia.sessions.list() query and the SAME
  // invalidateQueries()/refetch-on-remount behavior useSiaConversation.js
  // already has (see its two `queryClient.invalidateQueries(...)` calls) --
  // no new query key or frontend-side title generation is introduced. The
  // frontend never derives or optimistically displays a title itself: the
  // ONLY source of the title text asserted below is the (updated)
  // getSiaSessions mock response, exactly like a real backend refetch.
  it("23d. a new session's backend-derived title becomes visible via the existing invalidate/refetch cycle, without a page refresh", async () => {
    // 1. Initial session list has no new session yet.
    getSiaSessions.mockResolvedValue({ success: true, sessions: [] });
    askSia.mockResolvedValue(answer("Your score is healthy.", "new-sess-title-1"));

    renderEntryPoint();
    await openPanel();

    await act(async () => {
      openHistory();
    });
    expect(await screen.findByText("No past conversations yet.")).toBeInTheDocument();
    expect(getSiaSessions).toHaveBeenCalledTimes(1);

    // Back to conversation mode -- the composer only renders here.
    await act(async () => {
      openHistory();
    });
    expect(screen.getByRole("heading", { name: "Ask SIA" })).toBeInTheDocument();

    // 2. User starts/submits a brand-new conversation. The successful
    // /sia/ask response contains a sessionId but -- exactly like the real
    // backend contract -- no title field at all.
    await ask("Why is my financial health score low?");
    await screen.findByText("Your score is healthy.");
    expect(askSia.mock.calls[0][0]).not.toHaveProperty("title");
    expect(askSia.mock.calls[0][0]).not.toHaveProperty("sessionTitle");

    // 3. The backend now reports this session with its server-derived
    // title (and, alongside it, an older session with no title at all, to
    // simultaneously re-confirm the neutral fallback still applies).
    getSiaSessions.mockResolvedValue({
      success: true,
      sessions: [
        {
          sessionId: "new-sess-title-1",
          title: "Why is my financial health score low?",
          messageCount: 2,
          lastMessageAt: "2026-08-09T10:00:00.000Z",
        },
        { sessionId: "s-untitled", title: null, messageCount: 1, lastMessageAt: "2026-08-01T10:00:00.000Z" },
      ],
    });

    // 4. Opening history again -- WITHOUT any remount or page refresh --
    // refetches the existing sessions query and shows the backend-stored
    // title as the sole source of that text.
    await act(async () => {
      openHistory();
    });

    expect(await screen.findByText("Why is my financial health score low?")).toBeInTheDocument();
    expect(getSiaSessions.mock.calls.length).toBeGreaterThan(1);
    // Null/missing title on the other (pre-existing) session still falls
    // back to the same neutral label -- this refetch never invented a
    // title for either session.
    expect(screen.getByText("SIA conversation")).toBeInTheDocument();
    // The panel header is completely unaffected by any of this.
    expect(screen.getByRole("heading", { name: "Ask SIA" })).toBeInTheDocument();
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
    await openPanel();
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
    await openPanel();
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
    await openPanel();
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
    await openPanel();
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
    await openPanel();
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
    await openPanel();
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
    await openPanel();
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
    await openPanel();

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
    await openPanel();

    fireEvent.change(composer(), { target: { value: "Why is my financial health score low?" } });
    fireEvent.keyDown(composer(), { key: "Enter", shiftKey: true });
    expect(askSia).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.keyDown(composer(), { key: "Enter" });
    });
    expect(askSia).toHaveBeenCalledTimes(1);
  });

  it("39. focus returns to the launcher after closing", async () => {
    renderEntryPoint();
    await openPanel();

    fireEvent.click(screen.getByRole("button", { name: "Close SIA" }));

    expect(screen.getByRole("button", { name: "Ask SIA" })).toHaveFocus();
  });

  it("40. pending and error state changes are announced via live regions", async () => {
    let resolveAsk;
    askSia.mockImplementation(() => new Promise((resolve) => {
      resolveAsk = () => resolve(answer("Announced.", "s"));
    }));
    renderEntryPoint();
    await openPanel();

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
    await openPanel();

    expect(screen.getByRole("log", { name: "Conversation" })).toBeInTheDocument();

    await ask("Why is my financial health score low?");
    await screen.findByText("Labelled answer.");

    expect(screen.getByText("You said:")).toBeInTheDocument();
    expect(screen.getByText("SIA said:")).toBeInTheDocument();
  });

  it("blocks submission of blank and overlength input", async () => {
    renderEntryPoint();
    await openPanel();

    expect(askButton()).toBeDisabled();

    fireEvent.change(composer(), { target: { value: "   " } });
    expect(askButton()).toBeDisabled();

    fireEvent.change(composer(), { target: { value: "x".repeat(501) } });
    expect(askButton()).toBeDisabled();
    expect(screen.getByText("501 / 500")).toBeInTheDocument();

    expect(askSia).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
// Batch 3F: answer-grounding transparency
// ---------------------------------------------------------------------
describe("SIA conversation -- answer-grounding transparency (Batch 3F)", () => {
  // Batch 3F acceptance remediation: this fixture's `period` is a mocked
  // API response value used only to prove the component renders a period
  // WHEN one is present -- it does not assert or imply anything about
  // backend/sia/groundingService.js's own current behavior, which never
  // populates `period` today (see backend/tests/sia.grounding.test.js).
  const groundingFixture = (overrides = {}) => ({
    sources: [{ key: "financialHealth", label: "Financial health analysis", period: "2026-08-09" }],
    ...overrides,
  });

  it("a valid grounding snapshot renders a collapsed disclosure under the assistant answer", async () => {
    askSia.mockResolvedValue({ ...answer("Your score is healthy.", "sess-g1"), grounding: groundingFixture() });
    renderEntryPoint();
    await openPanel();

    await ask("Why is my financial health score low?");
    await screen.findByText("Your score is healthy.");

    const toggle = screen.getByRole("button", { name: /BALENISA data supported this answer \(1 source\)/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Financial health analysis")).not.toBeInTheDocument();
  });

  it("expanding the disclosure shows the label and period", async () => {
    askSia.mockResolvedValue({ ...answer("Your score is healthy.", "sess-g2"), grounding: groundingFixture() });
    renderEntryPoint();
    await openPanel();

    await ask("Why is my financial health score low?");
    await screen.findByText("Your score is healthy.");

    fireEvent.click(screen.getByRole("button", { name: /BALENISA data supported this answer/i }));
    expect(screen.getByText("Financial health analysis")).toBeInTheDocument();
    expect(screen.getByText("2026-08-09")).toBeInTheDocument();
  });

  it("the disclosure never renders under a user message", async () => {
    askSia.mockResolvedValue({ ...answer("Your score is healthy.", "sess-g3"), grounding: groundingFixture() });
    renderEntryPoint();
    await openPanel();

    await ask("Why is my financial health score low?");
    await screen.findByText("Your score is healthy.");

    // Exactly one disclosure toggle exists -- for the assistant turn only,
    // never a second one attached to the user's own question bubble.
    expect(screen.getAllByRole("button", { name: /BALENISA data supported this answer/i })).toHaveLength(1);
  });

  it("multiple assistant messages in the same conversation have independent disclosure state", async () => {
    askSia
      .mockResolvedValueOnce({ ...answer("First answer.", "sess-g4"), grounding: groundingFixture() })
      .mockResolvedValueOnce({
        ...answer("Second answer.", "sess-g4"),
        grounding: groundingFixture({ sources: [{ key: "trends", label: "Spending trends" }] }),
      });
    renderEntryPoint();
    await openPanel();

    await ask("Why is my financial health score low?");
    await screen.findByText("First answer.");
    await ask("Why did my spending change this month?");
    await screen.findByText("Second answer.");

    const toggles = screen.getAllByRole("button", { name: /BALENISA data supported this answer/i });
    expect(toggles).toHaveLength(2);

    fireEvent.click(toggles[0]);
    expect(toggles[0]).toHaveAttribute("aria-expanded", "true");
    expect(toggles[1]).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Financial health analysis")).toBeInTheDocument();
    expect(screen.queryByText("Spending trends")).not.toBeInTheDocument();
  });

  it.each([
    ["missing", undefined],
    ["empty sources", { sources: [] }],
    ["malformed (not an object)", "not-an-object"],
    ["a legacy message with no grounding key at all", undefined],
  ])("fails closed and renders no disclosure for %s grounding, without crashing", async (_label, grounding) => {
    const payload = answer("An answer with no grounding.", "sess-g5");
    if (grounding !== undefined) payload.grounding = grounding;
    askSia.mockResolvedValue(payload);
    renderEntryPoint();
    await openPanel();

    await ask("Why is my financial health score low?");
    expect(await screen.findByText("An answer with no grounding.")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: /BALENISA data supported this answer/i })).not.toBeInTheDocument();
  });

  it("a resumed/hydrated session's stored assistant message renders its own persisted grounding", async () => {
    getSiaSessions.mockResolvedValue({
      success: true,
      sessions: [{ sessionId: "s-grounded", title: "Older chat", messageCount: 2, lastMessageAt: "2026-08-01T10:00:00.000Z" }],
    });
    getSiaSessionMessages.mockResolvedValue({
      success: true,
      sessionId: "s-grounded",
      messages: [
        { role: "user", content: "Earlier question", intent: "HEALTH_EXPLANATION", createdAt: "2026-08-01T09:00:00.000Z" },
        {
          role: "assistant",
          content: "Earlier answer",
          intent: "HEALTH_EXPLANATION",
          createdAt: "2026-08-01T09:00:01.000Z",
          grounding: groundingFixture(),
        },
      ],
    });

    renderEntryPoint();
    await openPanel();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conversation history" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByText("Older chat"));
    });

    expect(await screen.findByText("Earlier answer")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /BALENISA data supported this answer \(1 source\)/i });
    fireEvent.click(toggle);
    expect(screen.getByText("Financial health analysis")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------
// Batch 3F acceptance remediation -- requirement 5 regression
// ---------------------------------------------------------------------
// Proves the notifyManager act()-wrapping fix above actually holds, without
// suppressing or filtering console output (the spy below always calls
// through to the real console.error, so a genuine warning is still printed
// to the test run exactly as it would be without this spy in place -- only
// its call arguments are additionally captured for assertion). Runs a
// realistic multi-turn, multi-query flow (ask, open history, select a
// session, delete a session) -- the combination Batch 3F's original
// acceptance review found the warning under -- inside one test, then
// asserts afterward that console.error was never called with any
// React/TanStack Query "not wrapped in act(...)" text.
describe("SIA conversation -- no React/TanStack Query act() warnings (Batch 3F acceptance remediation, requirement 5)", () => {
  it("a realistic multi-turn, multi-query session produces zero act(...) warnings", async () => {
    const realConsoleError = console.error;
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation((...args) => {
      realConsoleError(...args);
    });

    getSiaSessions.mockResolvedValue({
      success: true,
      sessions: [{ sessionId: "s-old", title: "Older chat", messageCount: 2, lastMessageAt: "2026-08-01T10:00:00.000Z" }],
    });
    getSiaSessionMessages.mockResolvedValue({
      success: true,
      sessionId: "s-old",
      messages: [
        { role: "user", content: "Earlier question", intent: "HEALTH_EXPLANATION", createdAt: "2026-08-01T09:00:00.000Z" },
        { role: "assistant", content: "Earlier answer", intent: "HEALTH_EXPLANATION", createdAt: "2026-08-01T09:00:01.000Z" },
      ],
    });
    deleteSiaSession.mockResolvedValue({ success: true, message: "Session deleted." });
    askSia.mockResolvedValue(answer("Your score is healthy.", "sess-regression"));

    renderEntryPoint();
    await openPanel();
    await ask("Why is my financial health score low?");
    await screen.findByText("Your score is healthy.");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conversation history" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByText("Older chat"));
    });
    await screen.findByText("Earlier answer");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conversation history" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Delete Older chat" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Confirm delete" }));
    });

    const actWarningPattern = /not (wrapped in act|configured to support act)/i;
    const offendingCalls = consoleErrorSpy.mock.calls.filter((call) =>
      call.some((arg) => typeof arg === "string" && actWarningPattern.test(arg))
    );
    expect(offendingCalls).toEqual([]);

    consoleErrorSpy.mockRestore();
  });
});
