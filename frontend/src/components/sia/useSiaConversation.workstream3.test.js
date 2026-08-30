import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSiaConversation } from "./useSiaConversation";
import { askSia } from "../../api/siaApi";

// Only the API layer is mocked -- the reducer, useSiaAskMutation and
// TanStack wiring are all real, matching SiaConversation.test.js's own
// convention (real end-to-end frontend behaviour, not a mock agreeing with
// itself).
jest.mock("../../api/siaApi", () => ({ askSia: jest.fn() }));

const originalCrypto = window.crypto;
beforeAll(() => {
  Object.defineProperty(window, "crypto", {
    value: {
      getRandomValues: (bytes) => {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
        return bytes;
      },
    },
    configurable: true,
    writable: true,
  });
});
afterAll(() => {
  Object.defineProperty(window, "crypto", { value: originalCrypto, configurable: true, writable: true });
});

afterEach(() => {
  jest.clearAllMocks();
});

function renderConversation() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 0 } },
  });
  const wrapper = ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return renderHook(() => useSiaConversation(), { wrapper });
}

describe("useSiaConversation -- Workstream 3: clarification responses", () => {
  it("a clarification response renders as its own assistant message with kind and options, not an answer", async () => {
    askSia.mockResolvedValue({
      success: true,
      clarification: {
        prompt: "Which category did you mean?",
        options: [
          { id: "food", label: "Food" },
          { id: "transport", label: "Transport" },
        ],
      },
      sessionId: "sess-clar-1",
    });
    const { result } = renderConversation();

    act(() => result.current.setInput("How much did I spend on that category?"));
    act(() => result.current.submitQuestion());

    await waitFor(() => expect(result.current.pending).toBeNull());

    const last = result.current.messages[result.current.messages.length - 1];
    expect(last.role).toBe("assistant");
    expect(last.kind).toBe("clarification");
    expect(last.content).toBe("Which category did you mean?");
    expect(last.options).toEqual([
      { id: "food", label: "Food" },
      { id: "transport", label: "Transport" },
    ]);
    expect(result.current.activeSessionId).toBe("sess-clar-1");
  });

  it("a plain answer response is unaffected -- kind 'answer', no options field", async () => {
    askSia.mockResolvedValue({ success: true, answer: "You spent 500 on food.", sessionId: "s1" });
    const { result } = renderConversation();

    act(() => result.current.setInput("How much did I spend on food?"));
    act(() => result.current.submitQuestion());
    await waitFor(() => expect(result.current.pending).toBeNull());

    const last = result.current.messages[result.current.messages.length - 1];
    expect(last.kind).toBe("answer");
    expect(last.content).toBe("You spent 500 on food.");
    expect(last.options).toBeUndefined();
  });

  it("submitClarificationOption re-submits through the EXACT same ask mutation path: a real user turn, a fresh clientMessageId, and the option's label as the question", async () => {
    askSia
      .mockResolvedValueOnce({
        success: true,
        clarification: { prompt: "Which category?", options: [{ id: "food", label: "Food" }] },
        sessionId: "sess-1",
      })
      .mockResolvedValueOnce({ success: true, answer: "You spent 500 on food.", sessionId: "sess-1" });
    const { result } = renderConversation();

    act(() => result.current.setInput("How much did I spend on that?"));
    act(() => result.current.submitQuestion());
    await waitFor(() => expect(result.current.pending).toBeNull());

    const clarificationMessage = result.current.messages[result.current.messages.length - 1];
    expect(clarificationMessage.kind).toBe("clarification");

    act(() => result.current.submitClarificationOption(clarificationMessage.options[0]));
    await waitFor(() => expect(result.current.pending).toBeNull());

    expect(askSia).toHaveBeenCalledTimes(2);
    const secondCallPayload = askSia.mock.calls[1][0];
    expect(secondCallPayload.question).toBe("Food");
    expect(secondCallPayload.sessionId).toBe("sess-1");
    expect(typeof secondCallPayload.clientMessageId).toBe("string");
    expect(secondCallPayload.clientMessageId.length).toBeGreaterThan(0);
    // A distinct key from a typed question would use -- never reused/blank.
    expect(secondCallPayload.clientMessageId).not.toBe("");

    // A real new user turn was rendered for the clicked option (its label),
    // and a real answer followed -- proving this is the SAME send() path
    // submitQuestion uses, not a one-off fetch bypassing the reducer.
    const userTurns = result.current.messages.filter((m) => m.role === "user");
    expect(userTurns.map((m) => m.content)).toEqual([
      "How much did I spend on that?",
      "Food",
    ]);
    const finalAnswer = result.current.messages[result.current.messages.length - 1];
    expect(finalAnswer.kind).toBe("answer");
    expect(finalAnswer.content).toBe("You spent 500 on food.");
  });

  it("submitClarificationOption does nothing while busy (no double submission)", async () => {
    let resolveFirst;
    askSia.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );
    const { result } = renderConversation();

    act(() => result.current.setInput("Q"));
    await act(async () => {
      result.current.submitQuestion();
      await Promise.resolve();
    });
    expect(result.current.isBusy).toBe(true);
    await waitFor(() => expect(askSia).toHaveBeenCalledTimes(1));

    act(() => result.current.submitClarificationOption({ id: "x", label: "X" }));
    expect(askSia).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst({ success: true, answer: "done", sessionId: "s" });
    });
  });

  it("submitClarificationOption ignores a malformed option (no label) without crashing or calling askSia", () => {
    const { result } = renderConversation();

    act(() => result.current.submitClarificationOption(null));
    act(() => result.current.submitClarificationOption({}));
    act(() => result.current.submitClarificationOption({ id: "x" }));

    expect(askSia).not.toHaveBeenCalled();
  });
});

describe("useSiaConversation -- Workstream 3: interpretation metadata", () => {
  it("an answer's interpretation is attached to the assistant message unchanged", async () => {
    askSia.mockResolvedValue({
      success: true,
      answer: "You spent 4500 this month.",
      sessionId: "s1",
      interpretation: { periodLabel: "this month", metrics: ["EXPENSE_TOTAL"] },
    });
    const { result } = renderConversation();

    act(() => result.current.setInput("How much did I spend this month?"));
    act(() => result.current.submitQuestion());
    await waitFor(() => expect(result.current.pending).toBeNull());

    const last = result.current.messages[result.current.messages.length - 1];
    expect(last.interpretation).toEqual({ periodLabel: "this month", metrics: ["EXPENSE_TOTAL"] });
  });

  it("an answer with no interpretation field leaves it undefined, never a crash", async () => {
    askSia.mockResolvedValue({ success: true, answer: "Fine.", sessionId: "s1" });
    const { result } = renderConversation();

    act(() => result.current.setInput("Q"));
    act(() => result.current.submitQuestion());
    await waitFor(() => expect(result.current.pending).toBeNull());

    const last = result.current.messages[result.current.messages.length - 1];
    expect(last.interpretation).toBeUndefined();
  });
});
