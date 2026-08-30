import React, { useRef } from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SiaLauncherProvider } from "./SiaLauncherContext";
import SiaAskButton from "./SiaAskButton";
import { useSiaLauncher } from "./SiaLauncherContext";
import {
  getSiaStatus,
  getSiaSessions,
  getSiaSessionMessages,
  deleteSiaSession,
} from "../../api/siaSessionsApi";
import { askSia } from "../../api/siaApi";

// Batch 3G: the shared contextual launcher's end-to-end contract.
//
// Renders the REAL SiaLauncherProvider -> SiaEntryPoint -> SiaPanel ->
// useSiaConversation -> useSiaStatusQuery stack (only the API layer is
// mocked), exactly like SiaAvailability.test.js does for the base panel --
// so these tests prove actual user-visible behavior (what text ends up in
// the composer, what has focus, whether the panel opens) rather than a
// component's internal props.
jest.mock("../../api/siaApi", () => ({ askSia: jest.fn() }));
jest.mock("../../api/siaSessionsApi", () => ({
  getSiaStatus: jest.fn(),
  getSiaSessions: jest.fn(),
  getSiaSessionMessages: jest.fn(),
  deleteSiaSession: jest.fn(),
}));
// Workstream 3: this stack now transitively renders SiaPanel ->
// SiaVoiceRecorderControls -> useSiaVoiceRecorder -> siaVoiceApi.js, which
// imports the shared axios instance -- mocked for the same ESM-import
// reason as the two mocks above. No test in this file exercises voice
// recording (see SiaPanel.workstream3.test.js/useSiaVoiceRecorder.test.js).
jest.mock("../../api/siaVoiceApi", () => ({ transcribeSiaAudio: jest.fn() }));

const ENV_KEY = "REACT_APP_SIA_ENABLED";
const originalFlag = process.env[ENV_KEY];

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

function setFlag(value) {
  if (value === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
}

beforeEach(() => {
  setFlag("true");
  getSiaStatus.mockResolvedValue({ success: true, available: true });
  getSiaSessions.mockResolvedValue({ success: true, sessions: [] });
  getSiaSessionMessages.mockResolvedValue({ success: true, sessionId: "s1", messages: [] });
  deleteSiaSession.mockResolvedValue({ success: true, message: "Session deleted." });
  askSia.mockResolvedValue({ success: true, answer: "An answer.", intent: "HEALTH_EXPLANATION", sessionId: "s1" });
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  if (originalFlag === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = originalFlag;
});

// A minimal consumer used only to prove that an UNKNOWN suggestion id
// fails closed -- this is the one scenario SiaAskButton itself cannot
// exercise, since it only ever passes fixed, real ids.
function RawLauncherButton({ suggestionId }) {
  const launcher = useSiaLauncher();
  return (
    <button type="button" onClick={() => launcher.openSiaWithQuestion(suggestionId)}>
      Raw trigger
    </button>
  );
}

function renderProvider(children) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SiaLauncherProvider>{children}</SiaLauncherProvider>
    </QueryClientProvider>
  );
}

const launcherButton = (name) => screen.getByRole("button", { name });
const composer = () => screen.getByLabelText(/your question/i);
const askButtonEl = () => screen.getByRole("button", { name: "Ask" });

// The status query is only started (not necessarily settled) by the time
// `getSiaStatus` has been called -- a bare click immediately afterward can
// race the query's own resolution, during which `blockedByAvailability` is
// legitimately true (the SAME "checking" state SiaAvailability.test.js
// covers). Tests that specifically want to observe the AVAILABLE prefill
// path settle first, exactly like SiaAvailability.test.js's own "available"
// describe block does: open the base launcher, wait for the composer to
// become enabled (proof the query resolved to available: true), then close
// it again so the scenario under test starts from a closed panel.
async function settleAvailability() {
  fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }));
  await waitFor(() => expect(composer()).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Close SIA" }));
  await waitFor(() => expect(screen.queryByLabelText(/your question/i)).not.toBeInTheDocument());
}

describe("SiaLauncherContext -- SiaLauncherProvider contract", () => {
  it("an unknown/malformed suggestion id fails closed: no panel, no crash, no state mutation", async () => {
    renderProvider(<RawLauncherButton suggestionId="not-a-real-suggestion" />);
    await waitFor(() => expect(getSiaStatus).toHaveBeenCalled());

    expect(() => fireEvent.click(launcherButton("Raw trigger"))).not.toThrow();

    // The panel never opened -- the launcher button is still the closed
    // "Ask SIA" state.
    expect(screen.getByRole("button", { name: "Ask SIA" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/your question/i)).not.toBeInTheDocument();
  });

  it("opens the panel and prefills the composer with the exact registered suggestion text when the composer is empty", async () => {
    renderProvider(<SiaAskButton suggestionId="spending-change" label="Ask SIA about this trend" />);
    await settleAvailability();

    fireEvent.click(launcherButton("Ask SIA about this trend"));

    expect(await screen.findByLabelText(/your question/i)).toHaveValue(
      "Why did my overall spending change this month?"
    );
  });

  it("focuses the composer after a valid contextual launch", async () => {
    renderProvider(<SiaAskButton suggestionId="budget-status" label="Ask SIA about my budget" />);
    await waitFor(() => expect(getSiaStatus).toHaveBeenCalled());

    fireEvent.click(launcherButton("Ask SIA about my budget"));

    const input = await screen.findByLabelText(/your question/i);
    await waitFor(() => expect(input).toHaveFocus());
  });

  it("never replaces an existing non-empty draft (manually typed text survives a contextual click)", async () => {
    renderProvider(<SiaAskButton suggestionId="spending-change" label="Ask SIA about this trend" />);
    await waitFor(() => expect(getSiaStatus).toHaveBeenCalled());

    // Open the base launcher first and type a manual draft.
    fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }));
    fireEvent.change(composer(), { target: { value: "My own in-progress question" } });

    fireEvent.click(launcherButton("Ask SIA about this trend"));

    expect(composer()).toHaveValue("My own in-progress question");
  });

  it("a same-card repeat click is harmless: composer text unchanged, panel stays open, no crash", async () => {
    renderProvider(<SiaAskButton suggestionId="budget-status" label="Ask SIA about my budget" />);
    await waitFor(() => expect(getSiaStatus).toHaveBeenCalled());

    fireEvent.click(launcherButton("Ask SIA about my budget"));
    await screen.findByLabelText(/your question/i);

    expect(() => fireEvent.click(launcherButton("Ask SIA about my budget"))).not.toThrow();
    expect(composer()).toHaveValue("Explain my current budget status and utilization.");
  });

  it("a second, different-card click does not replace the first suggestion's already-prefilled text", async () => {
    renderProvider(
      <>
        <SiaAskButton suggestionId="spending-change" label="Ask SIA about this trend" />
        <SiaAskButton suggestionId="budget-status" label="Ask SIA about my budget" />
      </>
    );
    await settleAvailability();

    fireEvent.click(launcherButton("Ask SIA about this trend"));
    await screen.findByLabelText(/your question/i);
    fireEvent.click(launcherButton("Ask SIA about my budget"));

    expect(composer()).toHaveValue("Why did my overall spending change this month?");
  });

  it("returns to conversation mode when a contextual button is clicked while history mode is showing", async () => {
    renderProvider(<SiaAskButton suggestionId="spending-change" label="Ask SIA about this trend" />);
    await waitFor(() => expect(getSiaStatus).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }));
    fireEvent.click(screen.getByRole("button", { name: "Conversation history" }));
    expect(screen.queryByLabelText(/your question/i)).not.toBeInTheDocument();

    fireEvent.click(launcherButton("Ask SIA about this trend"));

    expect(await screen.findByLabelText(/your question/i)).toHaveValue(
      "Why did my overall spending change this month?"
    );
  });

  it("while SIA is unavailable, the panel opens (so Retry is visible) but the composer is never prefilled", async () => {
    getSiaStatus.mockResolvedValue({ success: true, available: false });
    renderProvider(<SiaAskButton suggestionId="budget-status" label="Ask SIA about my budget" />);
    await waitFor(() => expect(getSiaStatus).toHaveBeenCalled());

    fireEvent.click(launcherButton("Ask SIA about my budget"));

    await screen.findByText(/SIA is temporarily unavailable/i);
    expect(composer()).toHaveValue("");
    expect(composer()).toBeDisabled();
  });

  it("while SIA is unavailable, focus moves to the Retry control rather than the disabled composer", async () => {
    getSiaStatus.mockResolvedValue({ success: true, available: false });
    renderProvider(<SiaAskButton suggestionId="budget-status" label="Ask SIA about my budget" />);
    await waitFor(() => expect(getSiaStatus).toHaveBeenCalled());

    fireEvent.click(launcherButton("Ask SIA about my budget"));

    const retryBtn = await screen.findByRole("button", { name: "Retry" });
    await waitFor(() => expect(retryBtn).toHaveFocus());
  });

  // Batch 3G remediation: contextual focus-signal replay regression.
  //
  // The audit found that because SiaPanel fully unmounts on close,
  // `focusRequestVersion` (owned by SiaEntryPoint, which never unmounts)
  // stays nonzero after a contextual launch. Before the fix, a later
  // ORDINARY (non-contextual) reopen remounted SiaPanel, whose focus effect
  // reran with the SAME already-consumed version and incorrectly replayed
  // the contextual focus behavior (forcing focus onto Retry, even though
  // this open was never a contextual click). These tests prove the fix:
  // an acknowledgement ref owned by SiaEntryPoint (survives the SiaPanel
  // unmount) prevents an already-handled version from ever being
  // reprocessed, while still correctly firing every genuinely NEW
  // contextual launch.
  describe("contextual focus-signal replay (Batch 3G remediation)", () => {
    it("a genuinely new contextual launch (first click) still moves focus to the composer", async () => {
      renderProvider(<SiaAskButton suggestionId="spending-change" label="Ask SIA about this trend" />);
      await waitFor(() => expect(getSiaStatus).toHaveBeenCalled());

      fireEvent.click(launcherButton("Ask SIA about this trend"));

      const input = await screen.findByLabelText(/your question/i);
      await waitFor(() => expect(input).toHaveFocus());
    });

    it("a second contextual launch (newer version) still moves focus, even after the panel was closed and reopened in between", async () => {
      renderProvider(
        <>
          <SiaAskButton suggestionId="spending-change" label="Ask SIA about this trend" />
          <SiaAskButton suggestionId="budget-status" label="Ask SIA about my budget" />
        </>
      );
      await settleAvailability();

      fireEvent.click(launcherButton("Ask SIA about this trend"));
      const firstInput = await screen.findByLabelText(/your question/i);
      await waitFor(() => expect(firstInput).toHaveFocus());

      // Move focus elsewhere and close via an ordinary close/reopen cycle
      // in between, then launch a SECOND, different contextual button --
      // this is a genuinely NEW version and must still focus.
      fireEvent.click(screen.getByRole("button", { name: "Close SIA" }));
      await waitFor(() => expect(screen.queryByLabelText(/your question/i)).not.toBeInTheDocument());

      fireEvent.click(launcherButton("Ask SIA about my budget"));
      const secondInput = await screen.findByLabelText(/your question/i);
      await waitFor(() => expect(secondInput).toHaveFocus());
    });

    it("closing after a contextual launch and then reopening via the ordinary global button does not replay the contextual focus behavior", async () => {
      getSiaStatus.mockResolvedValue({ success: true, available: false });
      renderProvider(<SiaAskButton suggestionId="budget-status" label="Ask SIA about my budget" />);
      await waitFor(() => expect(getSiaStatus).toHaveBeenCalled());

      // Contextual launch while blocked: focus correctly moves to Retry
      // (proven by the test above this describe block).
      fireEvent.click(launcherButton("Ask SIA about my budget"));
      const retryBtn = await screen.findByRole("button", { name: "Retry" });
      await waitFor(() => expect(retryBtn).toHaveFocus());

      // Close (unmounts SiaPanel; focusRequestVersion in SiaEntryPoint
      // stays at its already-handled value) and reopen via the PLAIN,
      // non-contextual "Ask SIA" button.
      fireEvent.click(screen.getByRole("button", { name: "Close SIA" }));
      await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }));

      const reopenedRetryBtn = await screen.findByRole("button", { name: "Retry" });
      // The regression: without the fix, this ordinary reopen would replay
      // the stale (already-consumed) focus request and force focus onto
      // Retry again, even though this open was never a contextual click.
      await waitFor(() => expect(reopenedRetryBtn).not.toHaveFocus());
    });

    it("an ordinary (non-contextual) open never forces focus onto the Retry control in the first place", async () => {
      getSiaStatus.mockResolvedValue({ success: true, available: false });
      renderProvider(<SiaAskButton suggestionId="budget-status" label="Ask SIA about my budget" />);
      await waitFor(() => expect(getSiaStatus).toHaveBeenCalled());

      fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }));

      const retryBtn = await screen.findByRole("button", { name: "Retry" });
      expect(retryBtn).not.toHaveFocus();
    });

    it("further composer/message activity after a contextual request was already handled does not re-trigger the focus effect", async () => {
      renderProvider(<SiaAskButton suggestionId="budget-status" label="Ask SIA about my budget" />);
      await settleAvailability();

      fireEvent.click(launcherButton("Ask SIA about my budget"));
      const input = await screen.findByLabelText(/your question/i);
      await waitFor(() => expect(input).toHaveFocus());

      // Move focus away deliberately, then continue interacting (typing
      // further, which changes conversation/message state but not
      // focusRequestVersion) -- this must NOT re-run the already-handled
      // focus request and pull focus back to the composer on its own.
      const closeBtn = screen.getByRole("button", { name: "Close SIA" });
      closeBtn.focus();
      expect(input).not.toHaveFocus();

      fireEvent.change(input, { target: { value: "Explain my current budget status and utilization. Please." } });

      expect(input).not.toHaveFocus();
      expect(closeBtn).toHaveFocus();
    });
  });

  it("does not prefill while a request is genuinely in flight", async () => {
    let releaseAsk;
    askSia.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseAsk = resolve;
        })
    );
    renderProvider(<SiaAskButton suggestionId="spending-change" label="Ask SIA about this trend" />);
    await waitFor(() => expect(getSiaStatus).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }));
    fireEvent.change(composer(), { target: { value: "Why is my financial health score low?" } });
    fireEvent.click(askButtonEl());

    // Now genuinely pending -- the composer was cleared by SUBMIT.
    await waitFor(() => expect(composer()).toHaveValue(""));

    fireEvent.click(launcherButton("Ask SIA about this trend"));

    // Still not prefilled: a request is in flight.
    expect(composer()).toHaveValue("");

    await act(async () => {
      releaseAsk({ success: true, answer: "ok", intent: "HEALTH_EXPLANATION", sessionId: "s1" });
      await Promise.resolve();
    });
  });

  it("does not prefill while a failed request is awaiting retry/dismiss, even with an empty composer", async () => {
    askSia.mockRejectedValueOnce({ response: { data: { message: "boom" } } });
    renderProvider(<SiaAskButton suggestionId="spending-change" label="Ask SIA about this trend" />);
    await waitFor(() => expect(getSiaStatus).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }));
    fireEvent.change(composer(), { target: { value: "Why is my financial health score low?" } });
    fireEvent.click(askButtonEl());

    await screen.findByText("boom");
    expect(composer()).toHaveValue("");

    fireEvent.click(launcherButton("Ask SIA about this trend"));

    expect(composer()).toHaveValue("");
  });

  it("SiaEntryPoint's own build-flag/open-close behavior is completely unaffected when mounted via the provider", async () => {
    setFlag("false");
    renderProvider(<SiaAskButton suggestionId="spending-change" label="Ask SIA about this trend" />);

    // Disabled build: neither the base launcher nor the contextual button
    // render (SiaAskButton itself checks isSiaEnabled()).
    expect(screen.queryByRole("button", { name: "Ask SIA" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ask SIA about this trend" })).not.toBeInTheDocument();
  });
});

// Batch 3G remediation: the audit found the architecture's render-isolation
// and Context-value-stability claims were correct in production code
// (SiaLauncherContext.js already wraps { openSiaWithQuestion } in
// useMemo(..., [openSiaWithQuestion])) but were NOT proven by any shipped
// test -- a stable CALLBACK identity is not the same claim as a stable
// CONTEXT VALUE identity, and neither was empirically demonstrated against
// the real provider/entry-point stack. These tests close that gap. Each
// would fail if SiaLauncherContext.js's `contextValue` were changed back to
// an inline object literal (`{ openSiaWithQuestion }` recreated every
// render), or if SiaEntryPoint's internal state were ever lifted into the
// Provider itself.
describe("SiaLauncherContext -- render isolation and Context value stability (Batch 3G remediation)", () => {
  it("the Context value object and openSiaWithQuestion retain identity across an unrelated parent rerender", async () => {
    const seenValues = [];

    function Probe() {
      const ctx = useSiaLauncher();
      seenValues.push(ctx);
      return null;
    }

    function Harness() {
      const [tick, setTick] = React.useState(0);
      return (
        <div>
          <button type="button" onClick={() => setTick((t) => t + 1)}>
            tick
          </button>
          <span data-testid="tick-value">{tick}</span>
          <SiaLauncherProvider>
            <Probe />
          </SiaLauncherProvider>
        </div>
      );
    }

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 0 } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>
    );
    await waitFor(() => expect(getSiaStatus).toHaveBeenCalled());

    expect(seenValues.length).toBeGreaterThanOrEqual(1);
    const firstValue = seenValues[0];
    const firstCallback = firstValue.openSiaWithQuestion;

    // Force several rerenders of an ancestor that is completely unrelated
    // to SIA state -- this remounts nothing, but does cause React to
    // re-render the whole Harness subtree, including Probe.
    fireEvent.click(screen.getByRole("button", { name: "tick" }));
    fireEvent.click(screen.getByRole("button", { name: "tick" }));
    fireEvent.click(screen.getByRole("button", { name: "tick" }));
    await waitFor(() => expect(screen.getByTestId("tick-value")).toHaveTextContent("3"));

    // The test would fail here if contextValue were a fresh object literal
    // on every SiaLauncherProvider render.
    expect(seenValues[seenValues.length - 1]).toBe(firstValue);
    expect(seenValues[seenValues.length - 1].openSiaWithQuestion).toBe(firstCallback);
  });

  it("a memoized contextual-card consumer does not rerender due to composer keystrokes or panel open/close", async () => {
    const renderCounts = [];

    const RenderCountingCard = React.memo(function RenderCountingCard() {
      const countRef = useRef(0);
      countRef.current += 1;
      renderCounts.push(countRef.current);
      return <SiaAskButton suggestionId="spending-change" label="Ask SIA about this trend" />;
    });

    renderProvider(<RenderCountingCard />);
    await settleAvailability();

    const countAfterMount = renderCounts[renderCounts.length - 1];
    expect(countAfterMount).toBe(1);

    // Reopen the base launcher (SiaEntryPoint's own isOpen state) and fire
    // five sequential composer keystrokes -- all of this state lives
    // entirely inside SiaEntryPoint, which the Provider renders as a
    // SIBLING of `children`, not an ancestor of it. This test would fail
    // (render count > 1) if that ownership boundary were ever violated.
    fireEvent.click(screen.getByRole("button", { name: "Ask SIA" }));
    await waitFor(() => expect(composer()).not.toBeDisabled());
    fireEvent.change(composer(), { target: { value: "a" } });
    fireEvent.change(composer(), { target: { value: "ab" } });
    fireEvent.change(composer(), { target: { value: "abc" } });
    fireEvent.change(composer(), { target: { value: "abcd" } });
    fireEvent.change(composer(), { target: { value: "abcde" } });
    fireEvent.click(screen.getByRole("button", { name: "Close SIA" }));
    await waitFor(() => expect(screen.queryByLabelText(/your question/i)).not.toBeInTheDocument());

    expect(renderCounts[renderCounts.length - 1]).toBe(countAfterMount);
    expect(renderCounts.every((count) => count === 1)).toBe(true);
  });
});
