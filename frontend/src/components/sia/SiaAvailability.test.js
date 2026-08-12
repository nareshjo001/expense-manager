import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SiaEntryPoint from "./SiaEntryPoint";
import { getSiaStatus, getSiaSessions, getSiaSessionMessages, deleteSiaSession } from "../../api/siaSessionsApi";
import { askSia } from "../../api/siaApi";

// Batch 3E: runtime availability / graceful degradation.
//
// Renders the REAL SiaEntryPoint + SiaPanel + useSiaConversation +
// useSiaStatusQuery stack (only the API layer is mocked), so these tests
// prove the actual user-visible behaviour rather than a component's props.
// The API modules are mocked -- matching this repository's established
// convention -- so the real axios instance (ESM, untransformed by CRA's
// Jest config) is never imported through the component tree.
jest.mock("../../api/siaApi", () => ({ askSia: jest.fn() }));
jest.mock("../../api/siaSessionsApi", () => ({
  getSiaStatus: jest.fn(),
  getSiaSessions: jest.fn(),
  getSiaSessionMessages: jest.fn(),
  deleteSiaSession: jest.fn(),
}));

const ENV_KEY = "REACT_APP_SIA_ENABLED";
const originalFlag = process.env[ENV_KEY];

// This jsdom environment exposes no `crypto` global at all, so a Web Crypto
// source is installed for the duration of these tests -- the same shim
// SiaConversation.test.js already uses. It stands in for the environment,
// not for the code under test: the real createClientMessageId still runs,
// and without a secure source it correctly throws rather than producing a
// weak idempotency key.
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

// This project's CRA Jest config enables `resetMocks`, which clears any
// implementation supplied in a jest.mock factory before each test, so the
// default shapes are (re)installed here.
beforeEach(() => {
  setFlag("true");
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

const UNAVAILABLE_TEXT = /SIA is temporarily unavailable\. You can still view previous conversations\./i;
const CHECKING_TEXT = /Checking SIA availability/i;

// 1. Build flag off -> no launcher AND no status request at all.
describe("SIA availability -- build-time flag", () => {
  it.each([undefined, "false", "TRUE", "1"])(
    "flag %s renders no launcher and issues no status request",
    async (value) => {
      setFlag(value);
      const { container } = renderEntryPoint();

      expect(container).toBeEmptyDOMElement();
      // Give any (incorrectly) scheduled query a chance to fire.
      await waitFor(() => expect(getSiaStatus).not.toHaveBeenCalled());
    }
  );

  // 2. Flag on -> the status query really runs through the API layer.
  it('flag "true" queries status through the established API layer', async () => {
    getSiaStatus.mockResolvedValue({ success: true, available: true });
    renderEntryPoint();

    await waitFor(() => expect(getSiaStatus).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Ask SIA" })).toBeInTheDocument();
  });
});

// 3. Loading state disables every submission route.
describe("SIA availability -- checking state", () => {
  it("disables the composer, Ask button, and suggestions while status is loading", async () => {
    // A promise that never settles keeps the query in its loading state.
    getSiaStatus.mockImplementation(() => new Promise(() => {}));
    renderEntryPoint();
    openPanel();

    expect(screen.getByRole("status")).toHaveTextContent(CHECKING_TEXT);
    expect(composer()).toBeDisabled();
    expect(askButton()).toBeDisabled();
    for (const suggestion of screen.getAllByRole("button", { name: /\?$/ })) {
      expect(suggestion).toBeDisabled();
    }
    // No Retry while still checking -- there is nothing to retry yet.
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });
});

// 4. available: true -> the existing flow works unchanged.
describe("SIA availability -- available", () => {
  it("enables the composer and submits a question normally", async () => {
    getSiaStatus.mockResolvedValue({ success: true, available: true });
    renderEntryPoint();
    await waitFor(() => expect(getSiaStatus).toHaveBeenCalled());
    openPanel();

    await waitFor(() => expect(composer()).not.toBeDisabled());
    // No availability notice at all when SIA is healthy.
    expect(screen.queryByText(UNAVAILABLE_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByText(CHECKING_TEXT)).not.toBeInTheDocument();

    fireEvent.change(composer(), { target: { value: "Why is my financial health score low?" } });
    fireEvent.click(askButton());

    await waitFor(() => expect(askSia).toHaveBeenCalledTimes(1));
  });
});

// 5, 8, 9, 10. available: false -> every submission route is blocked.
describe("SIA availability -- unavailable", () => {
  async function renderUnavailable() {
    getSiaStatus.mockResolvedValue({ success: true, available: false });
    const utils = renderEntryPoint();
    await waitFor(() => expect(getSiaStatus).toHaveBeenCalled());
    openPanel();
    await screen.findByText(UNAVAILABLE_TEXT);
    return utils;
  }

  it("shows the generic unavailable message and a Retry action, leaking no configuration detail", async () => {
    await renderUnavailable();

    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent(UNAVAILABLE_TEXT);
    expect(within(notice).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(notice).toHaveAttribute("aria-live", "polite");
  });

  it("disables the composer and the Ask button", async () => {
    await renderUnavailable();

    expect(composer()).toBeDisabled();
    expect(askButton()).toBeDisabled();
  });

  it("pressing Enter cannot submit", async () => {
    await renderUnavailable();

    fireEvent.keyDown(composer(), { key: "Enter", shiftKey: false });

    expect(askSia).not.toHaveBeenCalled();
  });

  it("clicking Ask cannot submit", async () => {
    await renderUnavailable();

    fireEvent.click(askButton());

    expect(askSia).not.toHaveBeenCalled();
  });

  it("clicking a suggested question cannot submit or populate the composer", async () => {
    await renderUnavailable();

    const suggestions = screen.getAllByRole("button", { name: /\?$/ });
    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) expect(suggestion).toBeDisabled();

    fireEvent.click(suggestions[0]);

    expect(askSia).not.toHaveBeenCalled();
    expect(composer()).toHaveValue("");
  });

  // 11. History stays fully usable while unavailable.
  it("keeps session history browsing accessible", async () => {
    getSiaSessions.mockResolvedValue({
      success: true,
      sessions: [
        { sessionId: "s1", title: null, messageCount: 2, lastMessageAt: "2026-08-01T10:00:00.000Z" },
      ],
    });
    await renderUnavailable();

    fireEvent.click(screen.getByRole("button", { name: "Conversation history" }));

    await waitFor(() => expect(getSiaSessions).toHaveBeenCalled());
    expect(screen.getByRole("region", { name: "Conversation history" })).toBeInTheDocument();
  });
});

// 6. Fail closed on a network failure or a malformed payload.
describe("SIA availability -- fails closed", () => {
  it.each([
    ["a rejected request", () => getSiaStatus.mockRejectedValue(new Error("network down"))],
    ["a malformed payload (no fields)", () => getSiaStatus.mockResolvedValue({})],
    ["a malformed payload (null)", () => getSiaStatus.mockResolvedValue(null)],
    ['available as the string "true"', () => getSiaStatus.mockResolvedValue({ success: true, available: "true" })],
    ["available as 1", () => getSiaStatus.mockResolvedValue({ success: true, available: 1 })],
    ["success false but available true", () => getSiaStatus.mockResolvedValue({ success: false, available: true })],
  ])("%s blocks submission and shows the safe unavailable experience", async (_label, arrange) => {
    arrange();
    renderEntryPoint();
    await waitFor(() => expect(getSiaStatus).toHaveBeenCalled());
    openPanel();

    // Bounded wait, not a sleep: useSiaStatusQuery.js hardcodes `retry: 1`
    // on the query itself, which takes precedence over this test's
    // client-level `retry: false` default. For the "a rejected request"
    // case specifically, that means TanStack performs one real retry with
    // its default ~1000ms backoff before the query settles into its error
    // state -- the same intentional retry lifecycle already documented in
    // the "SIA availability -- retry" describe block below. findByText's
    // implicit 1000ms default sits right at that boundary, which is fine
    // running this file alone but can tip over under full-suite CPU
    // contention. 3000ms comfortably covers the retry + backoff without
    // masking a genuine failure to reach the unavailable state.
    await screen.findByText(UNAVAILABLE_TEXT, {}, { timeout: 3000 });
    expect(composer()).toBeDisabled();
    expect(askButton()).toBeDisabled();

    fireEvent.keyDown(composer(), { key: "Enter", shiftKey: false });
    fireEvent.click(askButton());
    expect(askSia).not.toHaveBeenCalled();

    // The launcher/panel is never destroyed by a status failure.
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  // 13. Nothing sensitive is ever rendered, on any failure path.
  it("renders no provider, model, credential, env-var name, or raw error detail", async () => {
    getSiaStatus.mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED"), {
        response: { data: { provider: "openai", model: "gpt-4", key: "sk-secret" } },
      })
    );
    const { container } = renderEntryPoint();
    await waitFor(() => expect(getSiaStatus).toHaveBeenCalled());
    openPanel();
    // Same bounded wait as the parameterized "a rejected request" case
    // above: this is also a genuinely rejected getSiaStatus call, so it
    // hits useSiaStatusQuery.js's real `retry: 1` and its ~1000ms default
    // backoff before settling into the error state -- findByText's
    // implicit 1000ms default sits right at that boundary.
    await screen.findByText(UNAVAILABLE_TEXT, {}, { timeout: 3000 });

    const text = container.textContent;
    for (const forbidden of ["openai", "gpt-4", "sk-secret", "OPENAI_API_KEY", "SIA_ENABLED", "SIA_LLM_PROVIDER", "SIA_LLM_MODEL", "ECONNREFUSED"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

// 7. Retry refetches and can recover to available.
describe("SIA availability -- retry", () => {
  it("Retry refetches status and recovers to the working experience", async () => {
    // Every initial attempt fails. Note the hook's bounded `retry: 1` means
    // TanStack itself makes one extra attempt before settling into the
    // error state -- so the mock must reject for ALL of them, otherwise the
    // automatic retry would silently "recover" and this test would never
    // exercise the user-driven Retry control at all.
    getSiaStatus.mockRejectedValue(new Error("temporary failure"));

    renderEntryPoint();
    openPanel();
    // Generous timeout on purpose: the hook's bounded `retry: 1` adds
    // TanStack's own backoff delay before the query finally settles into
    // its error state, which exceeds findByText's 1s default.
    await screen.findByText(UNAVAILABLE_TEXT, {}, { timeout: 5000 });
    const callsBeforeRetry = getSiaStatus.mock.calls.length;

    // The backend comes back.
    getSiaStatus.mockResolvedValue({ success: true, available: true });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(composer()).not.toBeDisabled());
    expect(getSiaStatus.mock.calls.length).toBeGreaterThan(callsBeforeRetry);
    expect(screen.queryByText(UNAVAILABLE_TEXT)).not.toBeInTheDocument();
  });
});

// 12. Closing/reopening does not re-request status or lose the conversation.
describe("SIA availability -- panel close/reopen", () => {
  it("does not repeat the status request and preserves conversation state", async () => {
    getSiaStatus.mockResolvedValue({ success: true, available: true });
    renderEntryPoint();
    await waitFor(() => expect(getSiaStatus).toHaveBeenCalledTimes(1));

    openPanel();
    await waitFor(() => expect(composer()).not.toBeDisabled());

    fireEvent.change(composer(), { target: { value: "Why is my financial health score low?" } });
    fireEvent.click(askButton());
    await waitFor(() => expect(askSia).toHaveBeenCalledTimes(1));
    await screen.findByText("An answer.");

    // Close and reopen.
    fireEvent.click(screen.getByRole("button", { name: "Close SIA" }));
    expect(screen.queryByLabelText(/your question/i)).not.toBeInTheDocument();
    openPanel();

    // The transcript survived (state lives in SiaEntryPoint, not SiaPanel).
    expect(await screen.findByText("An answer.")).toBeInTheDocument();
    // And the status query was NOT re-issued.
    expect(getSiaStatus).toHaveBeenCalledTimes(1);
  });
});
